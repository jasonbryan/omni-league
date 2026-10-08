# Manual WCAG 2.2 AA checklist

The tester copies the block below into the `Test: PASS` comment of every UI PR (dev cycle Phase 5) and marks each item `pass`, `fail`, or `N/A` with a short note. It lists every criterion that [ADR 0005](../decisions/0005-e2e-and-accessibility-testing.md#wcag-22-aa-coverage) checks fully or partly by hand. The automated part (axe with the ADR tags, the 320px reflow check, and the Tab walk) runs in the e2e suite through the axe helper; this list covers what those cannot judge. Review the axe `incomplete` results attached to the e2e report (`axe-results`) under 1.4.3.

Check at 360px and 1280px wide, with the keyboard only where the item is about keyboard use. If an item's source in ADR 0005 changes, the ADR wins and this list is updated.

```markdown
### Manual WCAG 2.2 AA checklist (docs/process/wcag-checklist.md)

- [ ] 1.1.1 Non-text Content (A): alt text is meaningful, not only present —
- [ ] 1.3.1 Info and Relationships (A): headings and grouping match the visual structure —
- [ ] 1.3.2 Meaningful Sequence (A): DOM order matches reading order at 360px (CSS reordering included) —
- [ ] 1.3.3 Sensory Characteristics (A): instructions do not rely on shape, size, position, or sound alone —
- [ ] 1.3.5 Identify Input Purpose (AA): personal-data fields have `autocomplete` —
- [ ] 1.4.1 Use of Color (A): status, errors, and standings are not shown by colour alone —
- [ ] 1.4.3 Contrast (Minimum) (AA): axe `incomplete` contrast results reviewed —
- [ ] 1.4.4 Resize Text (AA): usable at 200% zoom —
- [ ] 1.4.5 Images of Text (AA): no images of text —
- [ ] 1.4.11 Non-text Contrast (AA): control borders, focus indicators, and icons at 3:1 —
- [ ] 1.4.12 Text Spacing (AA): no loss of content with increased line, paragraph, letter, and word spacing —
- [ ] 1.4.13 Content on Hover or Focus (AA): tooltips and popovers are dismissible, hoverable, and persistent —
- [ ] 2.1.2 No Keyboard Trap (A): dialogs can be left with the keyboard —
- [ ] 2.1.4 Character Key Shortcuts (A): only if single-key shortcuts exist; they can be turned off or remapped —
- [ ] 2.2.1 Timing Adjustable (A): time limits match ADR 0008 (7-day idle session, sign-in throttle message states the wait) —
- [ ] 2.2.2 Pause, Stop, Hide (A): auto-updating content (for example live scores) can be paused or is exempt —
- [ ] 2.3.1 Three Flashes (A): only if animation is added; nothing flashes more than three times a second —
- [ ] 2.4.3 Focus Order (A): the Tab order is logical, not only DOM order —
- [ ] 2.4.4 Link Purpose (In Context) (A): each link's purpose is clear from its text or context —
- [ ] 2.4.5 Multiple Ways (AA): site-level, when navigation changes —
- [ ] 2.4.6 Headings and Labels (AA): headings and labels are descriptive —
- [ ] 2.4.7 Focus Visible (AA): the focus indicator is clearly visible on every control —
- [ ] 2.5.1 Pointer Gestures (A): multipoint or path gestures have a single-pointer alternative —
- [ ] 2.5.2 Pointer Cancellation (A): actions fire on the up event or can be aborted —
- [ ] 2.5.4 Motion Actuation (A): only if device motion is used; it has a UI alternative —
- [ ] 2.5.7 Dragging Movements (AA): dragging (for example reordering lineups) has a non-drag alternative —
- [ ] 3.2.1 On Focus (A): focus causes no change of context —
- [ ] 3.2.2 On Input (A): changing a setting causes no unexpected change of context —
- [ ] 3.2.3 Consistent Navigation (AA): repeated navigation keeps its order across pages —
- [ ] 3.2.4 Consistent Identification (AA): same function, same name and icon across pages —
- [ ] 3.2.6 Consistent Help (A): help mechanisms keep the same relative place across pages —
- [ ] 3.3.2 Labels or Instructions (A): inputs have labels or instructions that say what is expected —
- [ ] 3.3.3 Error Suggestion (AA): error messages suggest a fix where one is known —
- [ ] 3.3.4 Error Prevention (Legal, Financial, Data) (AA): payment and registration flows have a review or confirm step —
- [ ] 3.3.7 Redundant Entry (A): information already entered in the flow is not asked for again —
- [ ] 3.3.8 Accessible Authentication (Minimum) (AA): sign-in allows password managers and paste (`autocomplete` `email`/`current-password`/`new-password`), no cognitive test —
```
