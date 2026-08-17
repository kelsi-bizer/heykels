import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="center-page">
      <div className="card">
        <h1>
          <span
            style={{
              background: "linear-gradient(92deg,var(--g1) 0%,var(--g2) 52%,var(--g3) 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            HeyKels
          </span>
        </h1>
        <p>
          Search that remembers your context instead of your search terms. Sign in to
          get started — we only ask for your name and email here.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: next || "/search" });
          }}
        >
          <button type="submit" className="gbtn">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.3 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 6.6-9.6 6.6-16.4z" />
              <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-5.7z" />
              <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.2-5.6c-2 1.4-4.6 2.2-8.1 2.2-6.3 0-11.7-3.8-13.6-9.3l-7.8 5.7C6.5 42.6 14.6 48 24 48z" />
            </svg>
            Continue with Google
          </button>
        </form>

        <p style={{ marginTop: 20, marginBottom: 0, fontSize: 12.5 }}>
          Google Workspace access is requested separately, later, and only when you
          ask HeyKels to do something that needs it.
        </p>
      </div>
    </div>
  );
}
