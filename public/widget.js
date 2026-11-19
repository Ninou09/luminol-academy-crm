/* Luminol Academy — chat bubble for the website. Paste:
   <script src="https://YOUR-CRM/widget.js" async></script> */
(function () {
  if (window.__luminolChat) return;
  window.__luminolChat = true;
  var origin = new URL(document.currentScript ? document.currentScript.src : location.href).origin;
  var ar = (document.documentElement.lang || "").slice(0, 2) === "ar";
  var side = ar ? "left" : "right";
  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", ar ? "دردشة" : "Discuter avec nous");
  btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  btn.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;width:60px;height:60px;border-radius:50%;border:0;background:#167e70;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;z-index:2147483646;display:flex;align-items:center;justify-content:center";
  var frame = null;
  btn.onclick = function () {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = origin + "/chat?embed=1";
      frame.title = "Chat";
      frame.style.cssText = "position:fixed;bottom:90px;" + side + ":20px;width:min(380px,calc(100vw - 40px));height:min(600px,calc(100vh - 120px));border:0;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);z-index:2147483646;background:#fff";
      document.body.appendChild(frame);
    } else frame.style.display = frame.style.display === "none" ? "block" : "none";
  };
  document.body.appendChild(btn);
})();
