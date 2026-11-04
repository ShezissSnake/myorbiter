// `n.toLocaleString("en")` builds a new Intl.NumberFormat on every call. V8 keeps one for the
// common cases, but JavaScriptCore (WebKitGTK, orbiter's webview on Linux) doesn't: a call there
// costs about 25 µs, against half a microsecond for a formatter made once. The pages format
// hundreds of figures this way as they draw (counts, mastery points, quantities), so it was a few
// milliseconds of every page's opening.
//
// This keeps one formatter per locale for calls without options. The text is the same: ECMA-402
// defines Number.prototype.toLocaleString as formatting with a new Intl.NumberFormat made from the
// same arguments. Anything else (options, a list of locales, a Number object) goes to the original.

let installed = false;

export function installIntlCache() {
  if (installed) return;
  installed = true;
  const original = Number.prototype.toLocaleString;
  const kept = new Map<string, Intl.NumberFormat>();
  Number.prototype.toLocaleString = function (this: number, locales?: string | string[], options?: Intl.NumberFormatOptions) {
    if (typeof this !== "number" || options !== undefined || (locales !== undefined && typeof locales !== "string")) return original.call(this, locales, options);
    const key = locales ?? "";
    let format = kept.get(key);
    if (!format) {
      // An invalid locale throws here, as the original would.
      format = new Intl.NumberFormat(locales);
      kept.set(key, format);
    }
    return format.format(this);
  };
}
