// km themes: children's themes of one design (17 looks, one layout) - see themes/km-themes.json, where this list comes
// from (ids, names, light background, mascots, day/night). Everything km-specific in the app is switched on by
// isKmTheme(); all other themes (and the old 3D "coverflow") stay as they are.

export interface KmTheme {
  id: string
  label: string
  /** light background: header text and status icons are dark */
  light: boolean
  mascot: { sleeping: string; awake: string }
  /** Tag & Nacht: night look between nightFrom and nightUntil (and during quiet time) */
  dayNight?: {
    nightFrom: string
    nightUntil: string
    alsoDuringQuietTime: boolean
    lightAtNight: boolean
    mascotNight: { sleeping: string; awake: string }
  }
}

export const KM_THEMES: readonly KmTheme[] = [
  {
    id: 'kuschelmond',
    label: 'Kuschelmond',
    light: false,
    mascot: {
      sleeping: '/theme-data/kuschelmond/maskottchen.svg',
      awake: '/theme-data/kuschelmond/maskottchen-wach.svg',
    },
  },
  {
    id: 'moosnest',
    label: 'Moosnest',
    light: false,
    mascot: {
      sleeping: '/theme-data/moosnest/maskottchen.svg',
      awake: '/theme-data/moosnest/maskottchen-wach.svg',
    },
  },
  {
    id: 'sonnenhof',
    label: 'Sonnenhof',
    light: true,
    mascot: {
      sleeping: '/theme-data/sonnenhof/maskottchen.svg',
      awake: '/theme-data/sonnenhof/maskottchen-wach.svg',
    },
  },
  {
    id: 'pferdehof',
    label: 'Pferdehof',
    light: true,
    mascot: {
      sleeping: '/theme-data/pferdehof/maskottchen.svg',
      awake: '/theme-data/pferdehof/maskottchen-wach.svg',
    },
  },
  {
    id: 'fussball',
    label: 'Fußball',
    light: false,
    mascot: {
      sleeping: '/theme-data/fussball/maskottchen.svg',
      awake: '/theme-data/fussball/maskottchen-wach.svg',
    },
  },
  {
    id: 'fahrzeuge',
    label: 'Fahrzeuge',
    light: false,
    mascot: {
      sleeping: '/theme-data/fahrzeuge/maskottchen.svg',
      awake: '/theme-data/fahrzeuge/maskottchen-wach.svg',
    },
  },
  {
    id: 'buecherregal',
    label: 'Bücherregal',
    light: false,
    mascot: {
      sleeping: '/theme-data/buecherregal/maskottchen.svg',
      awake: '/theme-data/buecherregal/maskottchen-wach.svg',
    },
  },
  {
    id: 'kassettenrekorder',
    label: 'Kassettenrekorder',
    light: false,
    mascot: {
      sleeping: '/theme-data/kassettenrekorder/maskottchen.svg',
      awake: '/theme-data/kassettenrekorder/maskottchen-wach.svg',
    },
  },
  {
    id: 'unterwasser',
    label: 'Unterwasser',
    light: false,
    mascot: {
      sleeping: '/theme-data/unterwasser/maskottchen.svg',
      awake: '/theme-data/unterwasser/maskottchen-wach.svg',
    },
  },
  {
    id: 'bastelpapier',
    label: 'Bastelpapier',
    light: true,
    mascot: {
      sleeping: '/theme-data/bastelpapier/maskottchen.svg',
      awake: '/theme-data/bastelpapier/maskottchen-wach.svg',
    },
  },
  {
    id: 'prinzessin',
    label: 'Prinzessin',
    light: true,
    mascot: {
      sleeping: '/theme-data/prinzessin/maskottchen.svg',
      awake: '/theme-data/prinzessin/maskottchen-wach.svg',
    },
  },
  {
    id: 'einhorn',
    label: 'Einhorn',
    light: true,
    mascot: {
      sleeping: '/theme-data/einhorn/maskottchen.svg',
      awake: '/theme-data/einhorn/maskottchen-wach.svg',
    },
  },
  {
    id: 'feenschloss',
    label: 'Feenschloss',
    light: false,
    mascot: {
      sleeping: '/theme-data/feenschloss/maskottchen.svg',
      awake: '/theme-data/feenschloss/maskottchen-wach.svg',
    },
  },
  {
    id: 'weltraum',
    label: 'Weltraum',
    light: false,
    mascot: {
      sleeping: '/theme-data/weltraum/maskottchen.svg',
      awake: '/theme-data/weltraum/maskottchen-wach.svg',
    },
  },
  {
    id: 'dinoland',
    label: 'Dinoland',
    light: false,
    mascot: {
      sleeping: '/theme-data/dinoland/maskottchen.svg',
      awake: '/theme-data/dinoland/maskottchen-wach.svg',
    },
  },
  {
    id: 'piratenbucht',
    label: 'Piratenbucht',
    light: true,
    mascot: {
      sleeping: '/theme-data/piratenbucht/maskottchen.svg',
      awake: '/theme-data/piratenbucht/maskottchen-wach.svg',
    },
  },
  {
    id: 'tagundnacht',
    label: 'Tag & Nacht',
    light: true,
    mascot: {
      sleeping: '/theme-data/tagundnacht/maskottchen.svg',
      awake: '/theme-data/tagundnacht/maskottchen-wach.svg',
    },
    dayNight: {
      nightFrom: '18:00',
      nightUntil: '07:00',
      alsoDuringQuietTime: true,
      lightAtNight: false,
      mascotNight: {
        sleeping: '/theme-data/tagundnacht/maskottchen-nacht.svg',
        awake: '/theme-data/tagundnacht/maskottchen-nacht-wach.svg',
      },
    },
  },
]

export function kmTheme(id: string | undefined): KmTheme | undefined {
  return KM_THEMES.find((theme) => theme.id === id)
}

export function isKmTheme(id: string | undefined): boolean {
  return kmTheme(id) !== undefined
}
