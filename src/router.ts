import { createRouter } from "sv-router";
import Landing from "./routes/Landing.svelte";
import Home from "./routes/Home.svelte";
import NewTask from "./routes/NewTask.svelte";
import Thread from "./routes/Thread.svelte";
import Review from "./routes/Review.svelte";
import Settings from "./routes/Settings.svelte";
import Device from "./routes/Device.svelte";
import Admin from "./routes/Admin.svelte";

export const { navigate, route } = createRouter({
  "/": Landing,
  "/app": Home,
  "/task": NewTask,
  "/thread/:id": Thread,
  "/thread/:id/review": Review,
  "/settings": Settings,
  "/device": Device,
  "/admin": Admin,
});
