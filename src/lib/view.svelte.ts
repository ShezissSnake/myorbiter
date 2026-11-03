// How much each page shows. With details off (the default) a page says the essentials: its
// figures without the sentence under each, a short description, the main columns. Hover keeps
// everything one step away. App keeps this in step with Settings (`details`) and marks <html>
// with data-details, which the shared components' styles read; `set` is App's way back to Settings.

export const view = $state<{ details: boolean; set: (on: boolean) => void }>({ details: false, set: () => {} });
