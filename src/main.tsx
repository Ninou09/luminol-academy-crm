import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import BookingPage from "./booking";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/noto-sans-arabic";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith("/book") ? <BookingPage /> : <App />}
  </React.StrictMode>,
);
