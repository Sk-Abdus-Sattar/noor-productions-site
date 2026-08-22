// ============================================================
// NOOR Productions — Reviews / Testimonials
// Firebase Auth + Firestore only (Spark/free plan, no Cloud
// Functions), notifications sent client-side via EmailJS.
//
// Data model:
//   verifiedClients/{emailLowercased}
//     email, status ("active" | "used" | "removed"), verifiedAt, usedAt
//   reviews/{emailLowercased}      <- doc ID = client's email
//     clientEmail, clientName, quote, rating (1-5), createdAt,
//     editedAt, editCount (0 or 1), adminReply, adminReplyAt
//
// One review per client, one edit allowed (editCount cap = 1).
// The moment a client submits their first review, their
// verifiedClients doc transitions "active" -> "used" in the same
// atomic batch as the review is created — see the writeBatch below.
// See ../firestore.rules for the security rules this depends on.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, updateDoc, increment, writeBatch,
  collection, query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ── CONFIG — fill these in, and keep them IDENTICAL to the ──
// ── same constants in admin.html                             ──
const firebaseConfig = {
  apiKey: "AIzaSyAl4um8RDnjju8cvMGcSLjtPCSCWh6qajM",
  authDomain: "noor-productions-site.firebaseapp.com",
  projectId: "noor-productions-site",
};

// EmailJS (emailjs.com free tier — no server needed).
// See SETUP.md for how to create the account + these templates.
const EMAILJS_PUBLIC_KEY    = "ClwYWQKbEtb0O6Z7E";
const EMAILJS_SERVICE_ID    = "service_9r1xpqi";
// EmailJS free plan caps you at 2 templates account-wide, and the other
// slot is already used by Delhi Boutique's live order template. So
// everything here reuses ONE generic template — its "To Email" field is
// {{to_email}}, a variable, not hardcoded, which is what makes reusing
// it for both client- and admin-facing messages possible.
const EMAILJS_TEMPLATE_ID   = "template_to_client"; // vars: to_email, to_name, subject, message
// ──────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

if (window.emailjs) {
  window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
} else {
  console.error("EmailJS SDK not loaded — check the <script> tag order in index.html");
}

function emailClient(toEmail, toName, subject, message) {
  if (!window.emailjs) return;
  return window.emailjs
    .send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, { to_email: toEmail, to_name: toName || toEmail, subject, message })
    .catch((e) => console.error("EmailJS (to client) failed:", e));
}
function emailAdmin(subject, message) {
  if (!window.emailjs) return;
  return window.emailjs
    .send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, { to_email: "noorproductions.as@gmail.com", to_name: "NOOR Productions", subject, message })
    .catch((e) => console.error("EmailJS (to admin) failed:", e));
}

function emailKey(email) {
  return (email || "").trim().toLowerCase();
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function starString(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return "★".repeat(v) + "☆".repeat(5 - v);
}
function goError(code) {
  window.location.href = `error.html?code=${code}`;
}

// ── Render testimonials grid ─────────────────────────────────
function renderReviews() {
  const grid = document.getElementById("testimonials-grid");
  const empty = document.getElementById("testimonials-empty");
  if (!grid || !empty) return;
  const q = query(collection(db, "reviews"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    if (snap.empty) {
      grid.innerHTML = "";
      grid.appendChild(empty);
      return;
    }
    grid.innerHTML = snap.docs.map((d) => {
      const r = d.data();
      const name = escapeHtml(r.clientName || "Verified client");
      const quote = escapeHtml(r.quote || "");
      const reply = escapeHtml(r.adminReply || "");
      return `<div class="testimonial-card">
        <p class="testimonial-rating">${starString(r.rating)}</p>
        <p class="testimonial-quote">"${quote}"</p>
        <p class="testimonial-author">— ${name}</p>
        ${r.adminReply ? `<div class="testimonial-reply">
          <span class="testimonial-reply-label">Reply from NOOR Productions</span>
          ${reply}
        </div>` : ""}
      </div>`;
    }).join("");
  }, (err) => {
    console.error("Reviews listener failed:", err);
  });
}

// ── Auth state ─────────────────────────────────────────────────
let currentUser = null;
const writeBtn = document.getElementById("write-feedback-btn");
const writeNote = document.querySelector(".write-feedback-note");

// Keeps the button label and helper text in sync with reality, so it's
// never ambiguous whether clicking will start a new review or edit the
// existing one (and whether any attempt is left at all).
async function refreshWriteButtonState() {
  if (!writeBtn) return;

  if (!currentUser) {
    writeBtn.innerHTML = 'WRITE A FEEDBACK <span class="deploy-arrow">&rarr;</span>';
    writeBtn.disabled = false;
    if (writeNote) writeNote.textContent = "To leave a review you must be a verified client, and signed up via Google.";
    return;
  }

  try {
    const key = emailKey(currentUser.email);
    const [clientSnap, reviewSnap] = await Promise.all([
      getDoc(doc(db, "verifiedClients", key)),
      getDoc(doc(db, "reviews", key)),
    ]);
    const clientStatus = clientSnap.exists() ? clientSnap.data().status : null;

    if (!reviewSnap.exists()) {
      writeBtn.innerHTML = 'WRITE A FEEDBACK <span class="deploy-arrow">&rarr;</span>';
      writeBtn.disabled = false;
      if (writeNote) {
        writeNote.textContent = (clientStatus === "active")
          ? "You can leave one review — you'll be able to edit it once afterward."
          : "This Google account isn't verified as a NOOR Productions client yet.";
      }
      return;
    }

    const editCount = reviewSnap.data().editCount || 0;
    if (editCount < 1) {
      writeBtn.innerHTML = 'EDIT YOUR REVIEW <span class="deploy-arrow">&rarr;</span>';
      writeBtn.disabled = false;
      if (writeNote) writeNote.textContent = "You've submitted your review — one edit is still available.";
    } else {
      writeBtn.innerHTML = "REVIEW SUBMITTED";
      writeBtn.disabled = true;
      if (writeNote) writeNote.textContent = "You've used your one review and your one edit — thank you for your feedback!";
    }
  } catch (e) {
    console.error("Couldn't refresh feedback button state:", e);
  }
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  const signinBtn = document.getElementById("google-signin-btn");
  if (signinBtn) signinBtn.style.display = user ? "none" : "inline-flex";
  refreshWriteButtonState();
});

document.getElementById("google-signin-btn")?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    console.error(e);
    alert("Sign-in failed. Please try again.");
  }
});

// ── Star-rating input ────────────────────────────────────────
const starButtons = Array.from(document.querySelectorAll("#review-rating-input .star-btn"));
let selectedRating = 0;

function paintStars(value) {
  starButtons.forEach((btn) => {
    btn.classList.toggle("is-filled", Number(btn.dataset.value) <= value);
  });
}
starButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedRating = Number(btn.dataset.value);
    paintStars(selectedRating);
  });
  btn.addEventListener("mouseenter", () => paintStars(Number(btn.dataset.value)));
});
document.getElementById("review-rating-input")?.addEventListener("mouseleave", () => paintStars(selectedRating));

// ── Write / edit review modal ────────────────────────────────
const overlay    = document.getElementById("review-modal-overlay");
const titleEl    = document.getElementById("review-modal-title");
const nameInput  = document.getElementById("review-name-input");
const quoteInput = document.getElementById("review-quote-input");
const submitBtn  = document.getElementById("review-modal-submit");
const statusEl   = document.getElementById("review-modal-status");
let modalMode = "create";

function openModal(mode, existing) {
  modalMode = mode;
  titleEl.textContent = mode === "edit" ? "Edit your review (last edit)" : "Write your review";
  nameInput.value = existing?.clientName || currentUser?.displayName || "";
  quoteInput.value = existing?.quote || "";
  selectedRating = existing?.rating || 0;
  paintStars(selectedRating);
  statusEl.textContent = "";
  overlay.classList.add("is-open");
}
document.getElementById("review-modal-close")?.addEventListener("click", () => {
  overlay.classList.remove("is-open");
});
overlay?.addEventListener("click", (e) => {
  if (e.target === overlay) overlay.classList.remove("is-open");
});

document.getElementById("write-feedback-btn")?.addEventListener("click", async () => {
  if (!currentUser) return goError("02");
  const key = emailKey(currentUser.email);
  try {
    const clientSnap = await getDoc(doc(db, "verifiedClients", key));
    const clientStatus = clientSnap.exists() ? clientSnap.data().status : null;
    // "used" still counts as a legitimate verified client — it just means
    // they've already submitted their one review and may now be editing it.
    if (clientStatus !== "active" && clientStatus !== "used") return goError("01");

    const reviewSnap = await getDoc(doc(db, "reviews", key));
    if (!reviewSnap.exists()) {
      if (clientStatus !== "active") return goError("01");
      openModal("create", null);
    } else if ((reviewSnap.data().editCount || 0) < 1) {
      openModal("edit", reviewSnap.data());
    } else {
      goError("03");
    }
  } catch (e) {
    console.error(e);
    goError("04");
  }
});

submitBtn?.addEventListener("click", async () => {
  const quote = quoteInput.value.trim();
  const name = nameInput.value.trim();
  if (!quote) { statusEl.textContent = "Please write something first."; return; }
  if (!selectedRating) { statusEl.textContent = "Please pick a star rating."; return; }
  if (!currentUser) return goError("02");

  const key = emailKey(currentUser.email);
  submitBtn.disabled = true;
  statusEl.textContent = "Submitting...";
  try {
    if (modalMode === "create") {
      // Atomic: the review is created AND the client's verifiedClients
      // status flips active -> used in the same commit, so one can't
      // succeed without the other.
      const batch = writeBatch(db);
      batch.set(doc(db, "reviews", key), {
        clientEmail: currentUser.email,
        clientName: name || currentUser.displayName || currentUser.email,
        rating: selectedRating,
        quote,
        createdAt: serverTimestamp(),
        editCount: 0
      });
      batch.update(doc(db, "verifiedClients", key), {
        status: "used",
        usedAt: serverTimestamp()
      });
      await batch.commit();
      emailAdmin(
        "New client review submitted",
        `${name || currentUser.email} (${currentUser.email}) just left a ${selectedRating}-star review:\n\n"${quote}"`
      );
    } else {
      await updateDoc(doc(db, "reviews", key), {
        quote,
        rating: selectedRating,
        clientName: name || currentUser.displayName || currentUser.email,
        editedAt: serverTimestamp(),
        editCount: increment(1)
      });
      emailAdmin(
        "Client edited their review",
        `${name || currentUser.email} (${currentUser.email}) edited their review to a ${selectedRating}-star review:\n\n"${quote}"`
      );
    }
    overlay.classList.remove("is-open");
    refreshWriteButtonState();
  } catch (e) {
    console.error(e);
    goError("04");
  } finally {
    submitBtn.disabled = false;
  }
});

renderReviews();
