export default function Content({ success }: { success: boolean }) {
	return <div className={`flex content-center p-5 h-[100px] ${success ? 'bg-green-600' : 'bg-red-600' }`}>
    {success && <h1 className='font-bold text-xl text-green-300'>Successfully completed payment. Hurray!!!</h1>}
    {!success && <h1 className='font-bold text-x1 text-red-300'>Operation proceeded with issues. Failure!!!</h1>}
  </div>
}
