// Development only: spares-preview.html's entry (the spares panel's prototype, made-up numbers).
// Vite builds index.html alone, so this page never ships.
import { mount } from "svelte";
import "../app.css";
import SparesPreview from "./SparesPreview.svelte";

export default mount(SparesPreview, { target: document.getElementById("app")! });
