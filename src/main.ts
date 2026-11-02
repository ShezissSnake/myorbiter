import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { installLogging } from "./lib/applog";

// Before anything else, so an error while the page starts is logged too.
installLogging();

export default mount(App, { target: document.getElementById("app")! });
