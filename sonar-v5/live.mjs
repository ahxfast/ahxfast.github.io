import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getAuth, getIdTokenResult, onAuthStateChanged, sendPasswordResetEmail,
         signInWithCustomToken, signInWithEmailAndPassword,
         signOut } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { getDatabase, onValue, ref } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-database.js";
import { firebaseConfig } from "./firebase-config.mjs";

export function startLive({ decodeGeneration, deriveView, render }) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const database = getDatabase(app);
  const form = document.getElementById("auth-form");
  const resetButton = document.getElementById("reset-password");
  const hostedPasswordButton = document.getElementById("hosted-password");
  const localForm = document.getElementById("local-access-form");
  const localAccessAvailable = ["localhost", "127.0.0.1"].includes(location.hostname);
  const panel = document.getElementById("auth-panel");
  const signOutButton = document.getElementById("sign-out");
  const authStatus = document.getElementById("auth-status");
  const connectionStatus = document.getElementById("connection");
  document.getElementById("mode-badge").textContent = "Private beta";
  panel.hidden = false;
  localForm.hidden = !localAccessAvailable;

  let snapshot = null;
  let databaseConnected = false;
  let authorized = false;
  let offsetMs = null;
  let detachCurrent = null;
  let authEpoch = 0;

  function clearSnapshot() {
    snapshot = null;
    document.getElementById("rows").replaceChildren();
    document.getElementById("details").replaceChildren();
    document.getElementById("watch-rows").replaceChildren();
    document.getElementById("watch-count").textContent = "0 watches";
    document.getElementById("watch-empty").hidden = false;
    document.getElementById("row-count").textContent = "0 rows";
    document.getElementById("generation").textContent = "—";
    document.getElementById("published-at").textContent = "—";
    document.getElementById("health").textContent = "No current V5 generation.";
  }

  function tick() {
    if (snapshot) {
      render(snapshot, deriveView(snapshot, {
        nowMs: Date.now(), connected: authorized && databaseConnected,
        fixtureMode: false, offsetMs,
      }));
    }
  }

  onValue(ref(database, ".info/connected"), (value) => {
    databaseConnected = value.val() === true;
    if (!databaseConnected) connectionStatus.textContent = "Disconnected · actionability removed";
    tick();
  });
  onValue(ref(database, ".info/serverTimeOffset"), (value) => {
    offsetMs = Number.isFinite(value.val()) ? value.val() : null;
    tick();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    authStatus.textContent = "Signing in…";
    const email = document.getElementById("auth-email").value.trim();
    const passwordInput = document.getElementById("auth-password");
    const password = passwordInput.value;
    passwordInput.value = "";
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      authStatus.textContent = "Sign-in failed. Use your Firebase password or request a reset below.";
    }
  });
  resetButton.addEventListener("click", async () => {
    const emailInput = document.getElementById("auth-email");
    if (!emailInput.reportValidity()) return;
    resetButton.disabled = true;
    authStatus.textContent = "Requesting a Firebase password reset email…";
    try {
      await sendPasswordResetEmail(auth, emailInput.value.trim());
      authStatus.textContent = "Check your inbox for the Firebase password reset link, set a new password, then sign in here.";
    } catch {
      authStatus.textContent = "Could not send a reset link. Check the email address and try again.";
    } finally {
      resetButton.disabled = false;
    }
  });
  hostedPasswordButton.addEventListener("click", async () => {
    if (!localAccessAvailable || !auth.currentUser || !authorized) return;
    hostedPasswordButton.disabled = true;
    authStatus.textContent = "Preparing a private password setup link…";
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch("/api/hosted-password-link", {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("link unavailable");
      const result = await response.json();
      if (typeof result.link !== "string" ||
          !result.link.startsWith("https://cryptowatcher-8dae1.firebaseapp.com/")) {
        throw new Error("invalid link");
      }
      location.assign(result.link);
    } catch {
      authStatus.textContent = "Could not create the password setup link. Try again while signed in locally.";
      hostedPasswordButton.disabled = false;
    }
  });
  localForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!localAccessAvailable) return;
    const input = document.getElementById("local-access-code");
    const code = input.value.trim();
    input.value = "";
    authStatus.textContent = "Checking local access code…";
    try {
      const response = await fetch("/api/local-sign-in", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }), cache: "no-store",
      });
      if (!response.ok) throw new Error("code rejected");
      const result = await response.json();
      if (typeof result.token !== "string") throw new Error("invalid response");
      await signInWithCustomToken(auth, result.token);
    } catch {
      authStatus.textContent = "Local code failed or was already used. Request a fresh code from the operator.";
    }
  });
  signOutButton.addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, async (user) => {
    const epoch = ++authEpoch;
    if (detachCurrent) { detachCurrent(); detachCurrent = null; }
    authorized = false;
    clearSnapshot();
    form.hidden = Boolean(user);
    resetButton.hidden = Boolean(user);
    localForm.hidden = !localAccessAvailable || Boolean(user);
    signOutButton.hidden = !user;
    hostedPasswordButton.hidden = true;
    if (!user) {
      authStatus.textContent = "Sign in with your V5 tester account.";
      connectionStatus.textContent = "Signed out · actionability removed";
      return;
    }
    try {
      const token = await getIdTokenResult(user, true);
      if (epoch !== authEpoch || auth.currentUser?.uid !== user.uid) return;
      if (token.claims.sonarV5Tester !== true) {
        authStatus.textContent = "This account has no V5 tester access.";
        connectionStatus.textContent = "Access denied";
        return;
      }
      authorized = true;
      hostedPasswordButton.hidden = !localAccessAvailable;
      authStatus.textContent = `Signed in as ${user.email ?? "V5 tester"}.`;
      connectionStatus.textContent = "Waiting for a V5 generation…";
      detachCurrent = onValue(ref(database, "sonarV5Staging/current"), (value) => {
        if (!value.exists()) {
          clearSnapshot();
          connectionStatus.textContent = "No V5 generation has been published yet";
          return;
        }
        try {
          const incoming = decodeGeneration(value.val());
          if (snapshot && incoming.generation < snapshot.generation) throw new Error("generation regressed");
          snapshot = incoming;
          tick();
        } catch {
          clearSnapshot();
          connectionStatus.textContent = "Unsupported V5 generation · actionability removed";
        }
      }, () => {
        authorized = false;
        connectionStatus.textContent = "V5 read denied or disconnected";
        tick();
      });
    } catch {
      authStatus.textContent = "Could not verify V5 tester access.";
      connectionStatus.textContent = "Access unavailable";
    }
  });

  setInterval(tick, 250);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
}
