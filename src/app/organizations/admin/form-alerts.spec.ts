import { DETAILS_ALERTS } from '../league/league-details-state';
import { SEASON_FORM_ALERTS } from '../league/season-form';
import { LOGO_ALERTS } from './admin-logo';
import { AlertTexts } from './alert-text';
import { INVITE_FORM_ALERTS } from './invite-form';
import { LEAGUE_FORM_ALERTS } from './league-form';
import { FORM_ALERTS } from './location-form';
import { PUBLISH_ALERTS } from './publish-league-dialog';
import { REMOVE_LOGO_ALERTS } from './remove-logo-dialog';

type AlertMap = Record<string, { title?: string; description: string }>;

const ALERT_MAPS: Record<string, AlertMap> = {
  'location form': FORM_ALERTS,
  'league form': LEAGUE_FORM_ALERTS,
  'invite form': INVITE_FORM_ALERTS,
  'season form': SEASON_FORM_ALERTS,
  'league details form': DETAILS_ALERTS,
  'publish league dialog': PUBLISH_ALERTS,
  'logo section': LOGO_ALERTS,
  'remove logo dialog': REMOVE_LOGO_ALERTS,
};

describe('form alert texts', () => {
  describe.each(Object.entries(ALERT_MAPS))('the %s', (_name, alerts) => {
    it('gives every kind except offline a heading and a description', () => {
      const kinds = Object.keys(alerts).filter((kind) => kind !== 'offline');

      expect(kinds.length).toBeGreaterThan(0);
      for (const kind of kinds) {
        expect(alerts[kind]?.title?.trim(), `${kind} title`).toBeTruthy();
        expect(alerts[kind]?.description.trim(), `${kind} description`).toBeTruthy();
      }
    });

    it('leaves the offline heading to the connection cause', () => {
      expect(alerts['offline']?.title).toBeUndefined();
      expect(alerts['offline']?.description.trim()).toBeTruthy();
    });
  });

  describe('the shared alert text type', () => {
    it('requires a title for every kind except offline and none for offline', () => {
      const complete = {
        failed: { title: 'It failed.', description: 'Try again.' },
        offline: { description: 'Try again when you’re connected.' },
      } satisfies AlertTexts<'failed' | 'offline'>;
      const untitled = {
        // @ts-expect-error a kind other than offline needs a title
        failed: { description: 'Try again.' },
        offline: { description: 'Try again when you’re connected.' },
      } satisfies AlertTexts<'failed' | 'offline'>;
      const titledOffline = {
        failed: { title: 'It failed.', description: 'Try again.' },
        // @ts-expect-error an offline alert takes its heading from the connection cause
        offline: { title: 'Ignored', description: 'Try again when you’re connected.' },
      } satisfies AlertTexts<'failed' | 'offline'>;

      expect([complete, untitled, titledOffline]).toHaveLength(3);
    });
  });
});
