import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000",
  // Send the HttpOnly auth cookie with every request.
  // The JWT is never stored in JS-readable storage anymore.
  withCredentials: true,
});

export default api;
