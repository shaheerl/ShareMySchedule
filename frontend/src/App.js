import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import SignIn from "./pages/SignIn";
import Register from "./pages/Register";
import Home from "./pages/Home";
import AccountSettings from "./pages/AccountSettings";
import Layout from "./Layout";
import ProtectedRoute from "./ProtectedRoute";
import { apiPost } from "./api";
import MySchedule from "./pages/MySchedule";
import ManualEntry from "./pages/ManualEntry";
import FindClassmates from "./pages/FindClassmates";
import Inbox from "./pages/Inbox";
import MyFriends from "./pages/MyFriends";
import Verified from "./pages/Verified";
import ResendVerification from "./pages/ResendVerification";


function AppRoutes() {
  const nav = useNavigate();

  useEffect(() => {
  const accessToken = localStorage.getItem("accessToken");
  if (accessToken) {
    nav("/home", { replace: true });
    return;
  }

const refreshToken = sessionStorage.getItem("refreshToken");


  if (refreshToken) {
    apiPost("/auth/refresh", { refreshToken })
      .then((res) => {
        localStorage.setItem("accessToken", res.accessToken);
        nav("/home", { replace: true });
      })
      .catch(() => {
        nav("/signin", { replace: true });
      });
  } else {
    nav("/signin", { replace: true });
  }
}, []);  // run only once at startup


  return (
    <Routes>
      {/* Public */}
      <Route path="/signin" element={<SignIn />} />
      <Route path="/register" element={<Register />} />
      <Route path="/resend-verification" element={<ResendVerification />} />

      {/* Protected layout */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
              <Route path="/verified" element={<Verified />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="/home" element={<Home />} />
<Route path="/find-classmates" element={<FindClassmates />} />
        <Route path="/account-settings" element={<AccountSettings />} />
        <Route path="/my-schedule" element={<MySchedule />} />
        <Route path="/my-friends" element={<MyFriends/>} />
<Route path="/manual-entry" element={<ManualEntry />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
