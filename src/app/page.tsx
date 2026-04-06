import Link from "next/link";

export default function LandingPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  return (
    <main className="container">
      <section className="hero">
        <h1>
          Find your <span style={{ color: "var(--accent)" }}>style</span>.
        </h1>
        <p>
          Swipe through any Pinterest board like it's Tinder. Like what speaks to you,
          add notes, and let AI tell you what it all says about your taste.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/api/auth/pinterest" className="btn primary">
            Continue with Pinterest
          </a>
          <Link href="/boards" className="btn">I'm already signed in</Link>
        </div>
        <div
          style={{
            marginTop: 16,
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.6,
            maxWidth: 620,
            marginInline: "auto",
          }}
        >
          You&apos;ll be redirected to <strong>pinterest.com</strong> to sign in.
          designr never asks for your Pinterest password. It only requests the
          Pinterest permissions needed to read your boards and, if you choose,
          save a new board with the pins you liked.
        </div>
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            fontSize: 14,
          }}
        >
          <a href="https://designr.quest/privacy" target="_blank" rel="noreferrer">
            Privacy policy
          </a>
          <a href="mailto:hello@designr.quest">hello@designr.quest</a>
        </div>
        {searchParams?.error && (
          <div style={{ marginTop: 24, display: "inline-block" }}>
            <div className="error">Auth error: {searchParams.error}</div>
          </div>
        )}
      </section>
    </main>
  );
}
