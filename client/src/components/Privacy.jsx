import { navigate } from '../router.js';

// App Store Connect needs a public privacy policy URL, and this is it:
// https://midpointfinderapp.vercel.app/privacy. Plain words, no legalese.
export default function Privacy() {
  return (
    <div className="app">
      <main className="prose">
        <a href="/" className="link back" onClick={(e) => { e.preventDefault(); navigate('/'); }}>&larr; midpoint</a>
        <h1>Privacy</h1>
        <p>midpoint helps a group of people pick a place to meet that is a fair trip for everyone. This page says what it keeps and why.</p>

        <h2>What we store</h2>
        <ul>
          <li><strong>Your account:</strong> name, email, and a login handled by Supabase. If you join a plan from an invite link without signing up, only the name you typed is stored.</li>
          <li><strong>Your location, only when you share it:</strong> the point you choose for a plan, either from your device or an address you type. It is used to find a fair middle for that plan and is visible to the other people on that plan. It is not tracked in the background and is not collected unless you tap to share it.</li>
          <li><strong>Plans:</strong> the title, what you said you were looking for, when, and who is on it.</li>
          <li><strong>Friends:</strong> who you have added or been added by.</li>
        </ul>

        <h2>Who else sees data</h2>
        <ul>
          <li><strong>Google Maps Platform</strong> receives locations and addresses to find places and travel times.</li>
          <li><strong>Anthropic</strong> receives the text you type when describing what you are looking for, and public venue reviews, to turn them into search filters and short descriptions. Nothing about who you are is sent.</li>
          <li><strong>Supabase</strong> handles sign-in. <strong>Railway</strong> and <strong>Vercel</strong> host the app.</li>
        </ul>
        <p>Your data is not sold and is not used for advertising.</p>

        <h2>Deleting your account</h2>
        <p>Tap your name in the app, then <em>Delete account</em>. Plans you host, your spots on other people's plans, your friends list, and your login are removed right away. This cannot be undone.</p>

        <h2>Contact</h2>
        <p>Questions: rishbaichwal@gmail.com</p>
      </main>
    </div>
  );
}
