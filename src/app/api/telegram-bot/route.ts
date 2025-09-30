import { Telegraf, Markup } from 'telegraf';
import { google, calendar_v3 } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { DateTime } from 'luxon';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new Telegraf(BOT_TOKEN);

// --- Google Calendar настройка ---
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n');
const TIMEZONE = 'Europe/Kiev';

const auth = new google.auth.JWT({
  email: GOOGLE_CLIENT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: SCOPES,
});

const calendar = google.calendar({ version: 'v3', auth });

// Простая "сессия" в памяти
const sessions = new Map<
  string,
  { startTime?: Date; phone?: string; name?: string; email?: string }
>();

// --- Получение доступных дней ---
async function getAvailableDays(daysAhead = 30, minDays = 10) {
  const now = DateTime.now().setZone(TIMEZONE);
  const availableDays: DateTime[] = [];

  for (let i = 1; i <= daysAhead; i++) {
    const day = now.plus({ days: i });
    const weekday = day.weekday; // 1 = Monday, 7 = Sunday
    if (weekday === 6 || weekday === 7) continue; // пропускаем субботу и воскресенье

    const slots = await getAvailableSlotsForDay(day);

    if (slots.length > 0 || availableDays.length < minDays) {
      availableDays.push(day);
    }

    if (availableDays.length >= minDays) break;
  }

  return availableDays;
}

// --- Получение слотов ---
async function getAvailableSlotsForDay(day: DateTime) {
  const slots: { start: DateTime; label: string }[] = [];
  const startHour = 11;
  const endHour = 19;
  const meetingDuration = 60; // мин
  const breakAfterMeeting = 30; // мин
  const maxMeetingsPerDay = 5;

  let meetingsCount = 0;
  let slotStart = day.set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });

  while (meetingsCount < maxMeetingsPerDay) {
    const slotEnd = slotStart.plus({ minutes: meetingDuration });

    const res = await calendar.events.list({
      // @ts-expect-error
      calendarId: CALENDAR_ID,
      timeMin: slotStart.toISO(),
      timeMax: slotEnd.toISO(),
      singleEvents: true,
    });

    // @ts-expect-error
    const events = res.data.items || [];

    if (events.length === 0) {
      slots.push({
        start: slotStart,
        label: slotStart.toFormat('HH:mm'),
      });
      meetingsCount++;
      slotStart = slotEnd.plus({ minutes: breakAfterMeeting });
    } else {
      slotStart = slotEnd.plus({ minutes: breakAfterMeeting });
    }

    if (slotStart.hour >= endHour) break;
  }

  return slots;
}

// --- Команды бота ---
bot.start((ctx) => {
  ctx.reply('Привет! 👋 Напиши /book, чтобы забронировать встречу.');
});

bot.command('book', async (ctx) => {
  const days = await getAvailableDays(30);
  const buttons = days.map((d) => [
    Markup.button.callback(d.toFormat('dd.MM.yyyy'), `day_${d.toISO()}`),
  ]);
  ctx.reply('Выберите день для встречи:', Markup.inlineKeyboard(buttons));
});

// --- Выбор дня ---
bot.action(/day_(.+)/, async (ctx) => {
  const day = DateTime.fromISO(ctx.match[1]).setZone(TIMEZONE);
  const slots = await getAvailableSlotsForDay(day);

  if (slots.length === 0) return ctx.reply('Нет доступных слотов на этот день.');

  const buttons = slots.map((s) => [
    Markup.button.callback(s.label, `slot_${s.start.toMillis()}`),
  ]);

  ctx.reply('Выберите удобное время:', Markup.inlineKeyboard(buttons));
});

// --- Выбор слота и запрос контакта ---
bot.action(/slot_(\d+)/, (ctx) => {
  const timestamp = parseInt(ctx.match[1]);
  const startTime = DateTime.fromMillis(timestamp).toJSDate(); // сохраняем JS Date
  sessions.set(String(ctx.from!.id), { startTime });

  ctx.reply(
    'Пожалуйста, поделитесь своим номером телефона для подтверждения брони:',
    Markup.keyboard([Markup.button.contactRequest('📱 Отправить контакт')])
      .oneTime()
      .resize(),
  );
});

// --- Получение контакта ---
bot.on('contact', (ctx) => {
  const userId = String(ctx.from!.id);
  const session = sessions.get(userId);
  if (!session || !session.startTime) return;

  const contact = ctx.message.contact;
  session.phone = contact.phone_number;
  session.name =
    contact.first_name + (contact.last_name ? ' ' + contact.last_name : '');
  sessions.set(userId, session);

  ctx.reply('Спасибо! Теперь введите ваш email для подтверждения брони:');
});

// --- Обработка email и создание события ---
bot.on('text', async (ctx) => {
  const userId = String(ctx.from!.id);
  const session = sessions.get(userId);
  if (!session || !session.startTime || !session.phone) return;

  const email = ctx.message.text.trim();
  if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(email)) {
    return ctx.reply('❌ Неверный формат email. Попробуйте снова:');
  }

  session.email = email;
  sessions.set(userId, session);

  const start = DateTime.fromJSDate(session.startTime, { zone: TIMEZONE });
  const end = start.plus({ minutes: 60 });

  try {
    const event: calendar_v3.Schema$Event = {
      summary: 'Консультация',
      description: `Забронировано через Telegram-бота.\nКлиент: ${session.name}\nТелефон: ${session.phone}\nEmail: ${session.email}\n💰 Статус оплаты: НЕ оплачено`,
      start: { dateTime: start.toISO(), timeZone: TIMEZONE },
      end: { dateTime: end.toISO(), timeZone: TIMEZONE },
      conferenceData: { createRequest: { requestId: `tg-${Date.now()}` } },
    };

    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
      conferenceDataVersion: 1,
    });

    const paymentLink = 'https://send.monobank.ua/jar/XXXXXXXXX'; // ваша ссылка
    const amount = 800;

    await ctx.reply(
      `✅ Встреча забронирована!\n` +
        `📅 Дата и время: ${start.toFormat('dd.MM.yyyy HH:mm')}\n` +
        (res.data.hangoutLink
          ? `🔗 Ссылка на Google Meet: ${res.data.hangoutLink}\n`
          : `ℹ️ Ссылка появится в приглашении.\n`) +
        `📞 Телефон: ${session.phone}\n` +
        `👤 Имя: ${session.name}\n` +
        `📧 Email: ${session.email}\n\n` +
        `💰 Статус оплаты: ❌ НЕ оплачено\n` +
        `Сумма: ${amount} грн\n` +
        `👉 [Оплатить](${paymentLink})`,
      { parse_mode: 'Markdown' },
    );

    sessions.delete(userId);
  } catch (err) {
    console.error('Ошибка при создании события:', err);
    await ctx.reply('⚠️ Не удалось забронировать встречу. Попробуйте позже.');
  }
});

// --- Webhook handler ---
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await bot.handleUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
