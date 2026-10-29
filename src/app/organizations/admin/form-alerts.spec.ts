import { DETAILS_ALERTS } from '../league/league-details-state';
import { SEASON_FORM_ALERTS } from '../league/season-form';
import { INVITE_FORM_ALERTS } from './invite-form';
import { LEAGUE_FORM_ALERTS } from './league-form';
import { FORM_ALERTS } from './location-form';
import { PUBLISH_ALERTS } from './publish-league-dialog';

type AlertMap = Record<string, { title?: string; description: string }>;

const ALERT_MAPS: Record<string, AlertMap> = {
  'location form': FORM_ALERTS,
  'league form': LEAGUE_FORM_ALERTS,
  'invite form': INVITE_FORM_ALERTS,
  'season form': SEASON_FORM_ALERTS,
  'league details form': DETAILS_ALERTS,
  'publish league dialog': PUBLISH_ALERTS,
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
});
