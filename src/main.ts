import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { installLogging } from "./lib/applog";
import { installFocusTips } from "./lib/focusTip";
import { installIntlCache } from "./lib/intlCache";
import { timing } from "./lib/timing";

// Before anything else, so an error while the page starts is logged too.
installLogging();
installFocusTips();
installIntlCache();
// Record timings' start-up: the first frame drawn (one callback, whether recording or not).
timing.noteStart();

export default mount(App, { target: document.getElementById("app")! });
