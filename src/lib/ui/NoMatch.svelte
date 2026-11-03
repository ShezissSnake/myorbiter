<script lang="ts">
  // The one line every list shows when a search or its filters hide everything, so a page's own
  // "nothing here" only ever means there's truly nothing. Clear puts the filters back.
  let { clear }: { clear: () => void } = $props();
</script>

<span class="nomatch">Nothing matches these filters · <button type="button" class="link" title="Clear the search and put the filters back as they were" onclick={clear}>Clear</button></span>

<style>
  .nomatch .link { font: inherit; letter-spacing: inherit; text-transform: inherit; }
</style>
