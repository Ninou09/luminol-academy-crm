import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import BookingPage from "./booking";
import {
  ResetPage,
  VerifyPage,
  PortalPage,
  FeedbackPage,
  PaidPage,
} from "./public";
const path = window.location.pathname;
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/noto-sans-arabic";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {path.startsWith("/book") ? (
      <BookingPage />
    ) : path.startsWith("/reset") ? (
      <ResetPage />
    ) : path.startsWith("/verify/") ? (
      <VerifyPage />
    ) : path.startsWith("/portal/") ? (
      <PortalPage />
    ) : path.startsWith("/feedback/") ? (
      <FeedbackPage />
    ) : path.startsWith("/paid") ? (
      <PaidPage />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
