// A small stand-in for the browser's DOM, enough for Svelte's client runtime to mount a component
// compiled by client-component-hooks.mjs (templates built node by node: `fragments: "tree"`), and
// for a test to read its text and press its buttons. Import it before Svelte's client internals:
// they read `window`, `document` and the node classes once, on the first mount. No layout, styles
// or HTML parsing: a test that needs those runs in the browser (the sweep, the help pictures).

type Listener = (e: { type: string; target: Node; currentTarget?: Node }) => void;

export class Node {
  static ELEMENT_NODE = 1;
  static TEXT_NODE = 3;
  static COMMENT_NODE = 8;
  static DOCUMENT_NODE = 9;
  static DOCUMENT_FRAGMENT_NODE = 11;
  nodeType = 0;
  nodeName = "";
  parentNode: Node | null = null;
  childNodes: Node[] = [];
  private listeners = new Map<string, Set<Listener>>();
  get ownerDocument(): Document {
    return document;
  }
  get firstChild(): Node | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): Node | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): Node | null {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) + 1] ?? null) : null;
  }
  get previousSibling(): Node | null {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) - 1] ?? null) : null;
  }
  get parentElement(): Element | null {
    return this.parentNode instanceof Element ? this.parentNode : null;
  }
  get isConnected(): boolean {
    return this.parentNode ? this.parentNode.isConnected : false;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v) this.appendChild(new Text(v));
  }
  /** Inserts `node` (a fragment's children, for a fragment) before `ref`, or last. */
  insertBefore<T extends Node>(node: T, ref: Node | null): T {
    const nodes = node instanceof DocumentFragment ? [...node.childNodes] : [node];
    if (node instanceof DocumentFragment) node.childNodes = [];
    for (const n of nodes) {
      n.parentNode?.removeChild(n);
      n.parentNode = this;
      const at = ref ? this.childNodes.indexOf(ref) : -1;
      if (at < 0) this.childNodes.push(n);
      else this.childNodes.splice(at, 0, n);
    }
    return node;
  }
  appendChild<T extends Node>(node: T): T {
    return this.insertBefore(node, null);
  }
  removeChild<T extends Node>(node: T): T {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }
  append(...nodes: (Node | string)[]) {
    for (const n of nodes) this.appendChild(typeof n === "string" ? new Text(n) : n);
  }
  before(...nodes: (Node | string)[]) {
    const p = this.parentNode;
    if (!p) return;
    for (const n of nodes) p.insertBefore(typeof n === "string" ? new Text(n) : n, this);
  }
  after(...nodes: (Node | string)[]) {
    const p = this.parentNode;
    if (!p) return;
    const next = this.nextSibling;
    for (const n of nodes) p.insertBefore(typeof n === "string" ? new Text(n) : n, next);
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  replaceWith(...nodes: (Node | string)[]) {
    this.before(...nodes);
    this.remove();
  }
  contains(other: Node | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  cloneNode(deep = false): Node {
    const copy = this.shallow();
    if (deep) for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
    return copy;
  }
  protected shallow(): Node {
    return new Node();
  }
  addEventListener(type: string, f: Listener) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(f);
  }
  removeEventListener(type: string, f: Listener) {
    this.listeners.get(type)?.delete(f);
  }
  /** Runs this node's listeners for `e`, then its ancestors' (a bubbling event, as a click is). */
  dispatchEvent(e: { type: string; target?: Node; composedPath?: () => Node[] }) {
    const path: Node[] = [];
    for (let n: Node | null = this; n; n = n.parentNode) path.push(n);
    path.push(document);
    // One event object along the whole path, as in a browser (Svelte marks it where it was handled).
    const ev = Object.assign(e, { target: this, composedPath: () => path, bubbles: true, cancelBubble: false, stopPropagation() {}, preventDefault() {} });
    for (const n of path) {
      Object.defineProperty(ev, "currentTarget", { value: n, configurable: true, writable: true });
      for (const f of n.listeners.get(e.type) ?? []) f.call(n, ev as never);
    }
    return true;
  }
}

export class CharacterData extends Node {
  data: string;
  constructor(data = "") {
    super();
    this.data = String(data);
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(v: string) {
    this.data = String(v ?? "");
  }
  override get textContent() {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = String(v ?? "");
  }
}

export class Text extends CharacterData {
  override nodeType = Node.TEXT_NODE;
  override nodeName = "#text";
  protected override shallow() {
    return new Text(this.data);
  }
}

export class Comment extends CharacterData {
  override nodeType = Node.COMMENT_NODE;
  override nodeName = "#comment";
  override get textContent() {
    return "";
  }
  protected override shallow() {
    return new Comment(this.data);
  }
}

export class DocumentFragment extends Node {
  override nodeType = Node.DOCUMENT_FRAGMENT_NODE;
  override nodeName = "#document-fragment";
  protected override shallow() {
    return new DocumentFragment();
  }
}

export class Element extends Node {
  override nodeType = Node.ELEMENT_NODE;
  readonly localName: string;
  readonly namespaceURI: string;
  attrs = new Map<string, string>();
  style: Record<string, unknown> = { setProperty() {}, removeProperty() {}, cssText: "" };
  constructor(name: string, ns = "http://www.w3.org/1999/xhtml") {
    super();
    this.localName = name.toLowerCase();
    this.namespaceURI = ns;
    this.nodeName = this.localName.toUpperCase();
  }
  get tagName() {
    return this.nodeName;
  }
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  toggleAttribute(k: string, on?: boolean) {
    const want = on ?? !this.attrs.has(k);
    if (want) this.attrs.set(k, "");
    else this.attrs.delete(k);
    return want;
  }
  get className() {
    return this.attrs.get("class") ?? "";
  }
  set className(v: string) {
    this.attrs.set("class", v);
  }
  get classList() {
    const el = this;
    const list = () => new Set(el.className.split(/\s+/).filter(Boolean));
    const put = (s: Set<string>) => (el.className = [...s].join(" "));
    return {
      contains: (c: string) => list().has(c),
      add: (...cs: string[]) => put(new Set([...list(), ...cs])),
      remove: (...cs: string[]) => put(new Set([...list()].filter((x) => !cs.includes(x)))),
      toggle: (c: string, on?: boolean) => {
        const s = list();
        const want = on ?? !s.has(c);
        if (want) s.add(c);
        else s.delete(c);
        put(s);
        return want;
      },
    };
  }
  get children(): Element[] {
    return this.childNodes.filter((c): c is Element => c instanceof Element);
  }
  get content(): DocumentFragment {
    return new DocumentFragment();
  }
  /** Every element under this one (not itself), in document order, for which `f` holds. */
  findAll(f: (e: Element) => boolean): Element[] {
    const out: Element[] = [];
    const walk = (n: Node) => {
      for (const c of n.childNodes) {
        if (c instanceof Element) {
          if (f(c)) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  focus() {}
  blur() {}
  click() {
    this.dispatchEvent({ type: "click" });
  }
  protected override shallow() {
    const e = new (this.constructor as typeof Element)(this.localName, this.namespaceURI);
    for (const [k, v] of this.attrs) e.attrs.set(k, v);
    return e;
  }
}

export class HTMLElement extends Element {
  get title() {
    return this.getAttribute("title") ?? "";
  }
  set title(v: string) {
    this.setAttribute("title", v);
  }
  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(v: boolean) {
    this.toggleAttribute("disabled", !!v);
  }
}

export class Document extends Node {
  override nodeType = Node.DOCUMENT_NODE;
  override nodeName = "#document";
  readonly body = new HTMLElement("body");
  readonly head = new HTMLElement("head");
  activeElement: Element | null = null;
  constructor() {
    super();
    this.appendChild(this.head);
    this.appendChild(this.body);
  }
  override get isConnected() {
    return true;
  }
  createElement(name: string) {
    return new HTMLElement(name);
  }
  createElementNS(ns: string, name: string) {
    return ns === "http://www.w3.org/1999/xhtml" ? new HTMLElement(name) : new Element(name, ns);
  }
  createTextNode(v: string) {
    return new Text(v);
  }
  createComment(v: string) {
    return new Comment(v);
  }
  createDocumentFragment() {
    return new DocumentFragment();
  }
  importNode(n: Node, deep = false) {
    return n.cloneNode(deep);
  }
}

const document = new Document();
const win = globalThis as unknown as Record<string, unknown>;
Object.assign(win, { Node, CharacterData, Text, Comment, DocumentFragment, Element, HTMLElement, Document, document });
win.window ??= globalThis;
win.navigator ??= { userAgent: "node" };
win.addEventListener ??= () => {};
win.removeEventListener ??= () => {};
win.requestAnimationFrame ??= (f: (t: number) => void) => setTimeout(() => f(Date.now()), 0);
win.cancelAnimationFrame ??= (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
win.getComputedStyle ??= () => ({ getPropertyValue: () => "" });

export { document };
