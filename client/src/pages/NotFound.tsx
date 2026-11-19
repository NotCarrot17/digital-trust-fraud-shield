import { Link } from 'wouter';
import { ShieldQuestion, ArrowRight } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center px-4 pb-28 text-center md:pb-12">
      <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
        <ShieldQuestion size={48} />
      </span>
      <h1 className="mt-6 text-3xl font-extrabold text-slate-900">This page does not exist</h1>
      <p className="mt-2 text-lg leading-relaxed text-slate-600">
        The page you are looking for was moved or never existed. You can go back to the home page.
      </p>
      <Link href="/">
        <div className="mt-6 flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white hover:bg-emerald-700">
          Go to the home page
          <ArrowRight size={22} />
        </div>
      </Link>
    </div>
  );
}
