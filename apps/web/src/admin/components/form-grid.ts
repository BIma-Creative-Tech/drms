/**
 * D4 (owner decision, DRMS 13/10 Umum #2): Odoo-style form rows — label LEFT of the input — for the custom forms and
 * dialogs built from `.pk-fld` cells (KAS_STYLE). Same proportions as the expense-request form grid of Wave 2
 * ((payload)/custom.scss "D4 … label LEFT of the input": label column 35 %, 12 px gap, label aligned to the first
 * line of the control); at ≤ 640 px the label goes back on top. Unlayered like KAS_STYLE (the layered custom.scss
 * rules would lose against `.pk-fld { display: flex }`). Wrap the cells in `.pk-fgrid`.
 */
export const FORM_GRID_STYLE = `
.pk-fgrid { display: grid; gap: 14px; }
@media (min-width: 641px) {
  .pk-fgrid > .pk-fld { display: grid; grid-template-columns: minmax(0, 35%) minmax(0, 1fr); column-gap: 12px; row-gap: 6px; align-items: start; }
  .pk-fgrid > .pk-fld > * { grid-column: 2; min-width: 0; }
  .pk-fgrid > .pk-fld > :is(label, .lbl) { grid-column: 1; grid-row: 1 / span 4; margin: 0; padding-top: 10px; line-height: 1.3; }
}
`
