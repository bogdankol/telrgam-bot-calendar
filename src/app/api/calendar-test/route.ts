import { NextRequest, NextResponse } from "next/server"
import { google } from "googleapis"

const SCOPES = ["https://www.googleapis.com/auth/calendar"]
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n")
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!

const auth = new google.auth.JWT({
  email: GOOGLE_CLIENT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: SCOPES
})
const calendar = google.calendar({ version: "v3", auth })

export async function GET(req: NextRequest) {
  try {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      maxResults: 5,
      orderBy: "startTime",
      singleEvents: true,
    })

    return NextResponse.json({
      ok: true,
      events: res.data.items?.map(ev => ({
        id: ev.id,
        summary: ev.summary,
        start: ev.start?.dateTime,
        end: ev.end?.dateTime,
      }))
    })
  } catch (err: any) {
    console.error("Google Calendar test error:", err)
    return NextResponse.json({
      ok: false,
      error: err.message,
      code: err.code,
    }, { status: 500 })
  }
}
