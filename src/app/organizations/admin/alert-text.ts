export interface AlertText {
  readonly title: string;
  readonly description: string;
}

/** An offline alert takes its heading from the connection cause, so its text has no title. */
export interface OfflineAlertText {
  readonly title?: never;
  readonly description: string;
}

export type AlertTexts<Kind extends string> = {
  readonly [K in Kind]: K extends 'offline' ? OfflineAlertText : AlertText;
};
