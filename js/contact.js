// ============================================================
// NOOR Productions — Contact form
// Sends via EmailJS (same account/service used for the reviews
// backend). Shared by index.html's homepage form and contact.html.
// ============================================================
(function () {
  // ── CONFIG ──────────────────────────────────────────────────
  var EMAILJS_PUBLIC_KEY  = "ClwYWQKbEtb0O6Z7E";
  var EMAILJS_SERVICE_ID  = "service_9r1xpqi";
  // EmailJS free plan caps you at 2 templates account-wide, and the other
  // slot is already used by Delhi Boutique's live order template — so this
  // reuses the same generic "template_to_client" as admin.html/reviews.js,
  // formatting the form fields into its {{subject}}/{{message}} shape and
  // sending to your own inbox.
  var EMAILJS_TEMPLATE_ID = "template_to_client"; // vars: to_email, to_name, subject, message
  var ADMIN_EMAIL         = "noorproductions.as@gmail.com";
  // ────────────────────────────────────────────────────────────

  if (!window.emailjs) {
    console.error("EmailJS SDK not loaded — check the <script> tag order.");
    return;
  }
  window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });

  document.querySelectorAll('form[id^="contact-form"]').forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var statusEl = document.getElementById("contact-form-status" + form.id.replace("contact-form", ""));
      var btn = form.querySelector(".contact-submit-btn");
      var data = new FormData(form);
      var name = data.get("name");
      var email = data.get("email");
      var projectType = data.get("projectType");
      var message = data.get("message");

      btn.disabled = true;
      if (statusEl) statusEl.textContent = "Sending...";

      window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: ADMIN_EMAIL,
        to_name: "NOOR Productions",
        subject: "New contact form submission from " + name,
        message: "Name: " + name + "\nEmail: " + email + "\nProject type: " + projectType + "\n\n" + message
      }).then(function () {
        if (statusEl) statusEl.textContent = "Thanks — we'll get back to you soon.";
        form.reset();
      }).catch(function (err) {
        console.error("Contact form send failed:", err);
        if (statusEl) statusEl.textContent = "Something went wrong sending that — please email us directly at noorproductions.as@gmail.com.";
      }).finally(function () {
        btn.disabled = false;
      });
    });
  });
})();
