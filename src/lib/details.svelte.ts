// Which item's details sheet is open. Any card or row can open it; App renders the one sheet.
class Details {
  unique = $state<string | null>(null);
  open(unique: string) {
    this.unique = unique;
  }
  close() {
    this.unique = null;
  }
}

export const details = new Details();
