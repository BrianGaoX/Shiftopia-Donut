/// <reference types="node" />
import { faker } from '@faker-js/faker'

faker.seed(12345)

interface EventType  { id: string; name: string }
interface FuncType   { id: string; name: string; room_setup: string; show_on_calendar: boolean; is_performance: boolean }
interface Series     { series_id: string; name: string; unique_id: string; announce_date_time: string; on_sale_date_time: string }
interface VenueEvent { event_id: string; name: string; start_date_time: string; end_date_time: string; number_of_event_days: number; event_type_id: string; event_type_name: string; estimated_total_attendance: number; series_id: string | null; is_tentative: boolean; is_definite: boolean }
interface VenueFunction { function_id: string; event_id: string; name: string; date: string; start_time: string; end_time: string; start_date_time: string; end_date_time: string; number_of_hours: number; expected_attendance: number; is_performance: boolean; function_type_id: string; function_type_name: string; room_id: string | null; room_name: string; venue_id: string; venue_name: string; event_type_name: string }
interface BookedSpace { id: string; event_id: string; room_id: string | null; room_name: string; room_setup: string; venue_id: string; attendance: number; room_capacity: number | null; square_footage: number | null; option_number: number; start_date: string; end_date: string; is_all_day: boolean; start_time: string; end_time: string; booked_status: string; usage_type: string; number_of_hours: number; is_invoiced: boolean }
interface Task { id: string; title: string; task_type: string; due_date: string; is_completed: boolean; event_id: string; event_name: string; assigned_to: string }
interface Room { id: string; name: string; max_capacity: number; square_footage: number; venue_id: string; venue_name: string; room_group: string; item_code: string; sub_room_ids: string[]; is_combo_room: boolean; is_active: boolean; conflicting_room_ids: string[] }

const VENUE_ID   = 'v-icc-001'

const EVENT_TYPES: EventType[] = [
  { id: 'et-001', name: 'Conference'    },
  { id: 'et-002', name: 'Exhibition'    },
  { id: 'et-003', name: 'Concert'       },
  { id: 'et-004', name: 'Trade Show'    },
  { id: 'et-005', name: 'Gala Dinner'   },
  { id: 'et-006', name: 'Corporate'     },
  { id: 'et-007', name: 'Sporting Event'},
  { id: 'et-008', name: 'Festival'      },
]

const FUNCTION_TYPES: FuncType[] = [
  { id: 'ft-001', name: 'Reception',   room_setup: 'Cocktail',   show_on_calendar: true,  is_performance: false },
  { id: 'ft-002', name: 'Dinner',      room_setup: 'Banquet',    show_on_calendar: true,  is_performance: false },
  { id: 'ft-003', name: 'Meeting',     room_setup: 'Boardroom',  show_on_calendar: true,  is_performance: false },
  { id: 'ft-004', name: 'Performance', room_setup: 'Theatre',    show_on_calendar: true,  is_performance: true  },
  { id: 'ft-005', name: 'Setup',       room_setup: 'Empty',      show_on_calendar: false, is_performance: false },
  { id: 'ft-006', name: 'Breakout',    room_setup: 'Classroom',  show_on_calendar: true,  is_performance: false },
  { id: 'ft-007', name: 'Ceremony',    room_setup: 'Theatre',    show_on_calendar: true,  is_performance: false },
  { id: 'ft-008', name: 'Workshop',    room_setup: 'U-Shape',    show_on_calendar: true,  is_performance: false },
]

const V_CONV = 'v-icc-convention'
const V_EXHB = 'v-icc-exhibition'
const V_TTEC = 'v-tiktok-ec'
const N_CONV = 'ICC Sydney Convention'
const N_EXHB = 'ICC Sydney Exhibition'
const N_TTEC = 'TikTok Entertainment Centre'

const ROOMS: Room[] = [
  { id: 'darling-harbour-theatre', name: 'Darling Harbour Theatre', max_capacity: 2500, square_footage:     0, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'DHT',         sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'pyrmont-theatre',         name: 'Pyrmont Theatre',         max_capacity: 1000, square_footage:     0, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'PT',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c2-1',                    name: 'Meeting Room C2.1',       max_capacity:  110, square_footage:  1140, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'C2.1',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c2-2',                    name: 'Meeting Room C2.2',       max_capacity:   90, square_footage:   970, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'C2.2',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c2-3',                    name: 'Meeting Room C2.3',       max_capacity:  170, square_footage:  1785, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'C2.3',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c2-2-c2-3',               name: 'Meeting Room C2.2 + C2.3',max_capacity:  260, square_footage:  2755, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'C2.2+C2.3',   sub_room_ids: ['c2-2','c2-3'],  is_combo_room: true,  is_active: true, conflicting_room_ids: ['c2-2','c2-3']  },
  { id: 'c2-4',                    name: 'Meeting Room C2.4',       max_capacity:   90, square_footage:   945, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'C2.4',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c2-5',                    name: 'Meeting Room C2.5',       max_capacity:   90, square_footage:   970, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'C2.5',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c2-6',                    name: 'Meeting Room C2.6',       max_capacity:   90, square_footage:  1000, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'C2.6',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c2-5-c2-6',               name: 'Meeting Room C2.5 + C2.6',max_capacity:  180, square_footage:  1970, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'C2.5+C2.6',   sub_room_ids: ['c2-5','c2-6'],  is_combo_room: true,  is_active: true, conflicting_room_ids: ['c2-5','c2-6']  },
  { id: 'parkside',                name: 'Parkside Ballroom',       max_capacity: 1429, square_footage: 13565, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'PB',          sub_room_ids: ['parkside-1','parkside-2'], is_combo_room: true, is_active: true, conflicting_room_ids: ['parkside-1','parkside-2'] },
  { id: 'parkside-1',              name: 'Parkside Ballroom 1',     max_capacity:  962, square_footage:  9485, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'PB1',         sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'parkside-2',              name: 'Parkside Ballroom 2',     max_capacity:  396, square_footage:  4080, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'PB2',         sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'gallery',                 name: 'The Gallery',             max_capacity: 2410, square_footage: 25910, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Two',   item_code: 'GAL',         sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },

  { id: 'cockle-bay',              name: 'Cockle Bay Room',         max_capacity:  790, square_footage:  7985, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'CBR',         sub_room_ids: ['cb-1','cb-2'],  is_combo_room: true,  is_active: true, conflicting_room_ids: ['cb-1','cb-2']  },
  { id: 'cb-1',                    name: 'Cockle Bay Room 1',       max_capacity:  370, square_footage:  3995, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'CB1',         sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'cb-2',                    name: 'Cockle Bay Room 2',       max_capacity:  370, square_footage:  3995, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'CB2',         sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c3-1',                    name: 'Meeting Room C3.1',       max_capacity:  120, square_footage:  1280, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'C3.1',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c3-2',                    name: 'Meeting Room C3.2',       max_capacity:  150, square_footage:  1605, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'C3.2',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c3-3',                    name: 'Meeting Room C3.3',       max_capacity:  245, square_footage:  2520, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'C3.3',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c3-4',                    name: 'Meeting Room C3.4',       max_capacity:  140, square_footage:  1465, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'C3.4',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c3-5',                    name: 'Meeting Room C3.5',       max_capacity:  140, square_footage:  1465, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'C3.5',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c3-4-c3-5',               name: 'Meeting Room C3.4 + C3.5',max_capacity:  270, square_footage:  2930, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'C3.4+C3.5',   sub_room_ids: ['c3-4','c3-5'],  is_combo_room: true,  is_active: true, conflicting_room_ids: ['c3-4','c3-5']  },
  { id: 'c3-6',                    name: 'Meeting Room C3.6',       max_capacity:  222, square_footage:  2305, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Three', item_code: 'C3.6',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },

  { id: 'c4-1',                    name: 'Meeting Room C4.1',       max_capacity:  280, square_footage:  2970, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.1',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-2',                    name: 'Meeting Room C4.2',       max_capacity:  120, square_footage:  1270, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.2',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-3',                    name: 'Meeting Room C4.3',       max_capacity:  140, square_footage:  1495, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.3',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-4',                    name: 'Meeting Room C4.4',       max_capacity:  331, square_footage:  3035, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.4',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-5',                    name: 'Meeting Room C4.5',       max_capacity:  351, square_footage:  3425, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.5',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-6',                    name: 'Meeting Room C4.6',       max_capacity:  124, square_footage:  1215, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.6',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-7',                    name: 'Meeting Room C4.7',       max_capacity:  140, square_footage:  1540, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.7',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-6-c4-7',               name: 'Meeting Room C4.6 + C4.7',max_capacity:  280, square_footage:  2970, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.6+C4.7',   sub_room_ids: ['c4-6','c4-7'],  is_combo_room: true,  is_active: true, conflicting_room_ids: ['c4-6','c4-7']  },
  { id: 'c4-8',                    name: 'Meeting Room C4.8',       max_capacity:  290, square_footage:  3155, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.8',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-9',                    name: 'Meeting Room C4.9',       max_capacity:  166, square_footage:  1520, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.9',        sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-10',                   name: 'Meeting Room C4.10',      max_capacity:  166, square_footage:  1520, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.10',       sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'c4-9-c4-10',              name: 'Meeting Room C4.9 + C4.10',max_capacity: 323, square_footage:  3055, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.9+C4.10',  sub_room_ids: ['c4-9','c4-10'], is_combo_room: true,  is_active: true, conflicting_room_ids: ['c4-9','c4-10'] },
  { id: 'c4-11',                   name: 'Meeting Room C4.11',      max_capacity:  261, square_footage:  2635, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Four',  item_code: 'C4.11',       sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },

  { id: 'gb-b1-b2-b3',             name: 'Grand Ballroom B1 + B2 + B3', max_capacity: 2880, square_footage: 31000, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Five', item_code: 'GB-B1+B2+B3', sub_room_ids: ['gb-b1','gb-b2','gb-b3'], is_combo_room: true, is_active: true, conflicting_room_ids: ['gb-b1','gb-b2','gb-b3'] },
  { id: 'gb-b1',                   name: 'Grand Ballroom B1',       max_capacity: 1270, square_footage: 13690, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Five',  item_code: 'GB-B1',       sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'gb-b2',                   name: 'Grand Ballroom B2',       max_capacity:    0, square_footage:  5005, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Five',  item_code: 'GB-B2',       sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'gb-b3',                   name: 'Grand Ballroom B3',       max_capacity: 1140, square_footage: 12305, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Five',  item_code: 'GB-B3',       sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'gb-b1-b2',                name: 'Grand Ballroom B1 + B2',  max_capacity: 1740, square_footage: 18695, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Five',  item_code: 'GB-B1+B2',    sub_room_ids: ['gb-b1','gb-b2'],is_combo_room: true,  is_active: true, conflicting_room_ids: ['gb-b1','gb-b2']},
  { id: 'gb-b2-b3',                name: 'Grand Ballroom B2 + B3',  max_capacity: 1610, square_footage: 17310, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Five',  item_code: 'GB-B2+B3',    sub_room_ids: ['gb-b2','gb-b3'],is_combo_room: true,  is_active: true, conflicting_room_ids: ['gb-b2','gb-b3']},
  { id: 'gb-mode-1',               name: 'Grand Ballroom Mode 1',   max_capacity: 1740, square_footage: 18695, venue_id: V_CONV, venue_name: N_CONV, room_group: 'Level Five',  item_code: 'GB-M1',       sub_room_ids: ['gb-b1','gb-b2'],is_combo_room: true,  is_active: true, conflicting_room_ids: ['gb-b1','gb-b2']},

  { id: 'hall-1',                  name: 'Hall 1',                  max_capacity: 3600, square_footage: 47135, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level One',   item_code: 'H1',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'hall-2',                  name: 'Hall 2',                  max_capacity: 3750, square_footage: 48555, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level One',   item_code: 'H2',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'hall-3',                  name: 'Hall 3',                  max_capacity: 4500, square_footage: 58265, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level One',   item_code: 'H3',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'hall-4',                  name: 'Hall 4',                  max_capacity: 3900, square_footage: 51020, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level One',   item_code: 'H4',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'halls-l1',                name: 'Level 1 Halls total',     max_capacity:15800, square_footage:204975, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level One',   item_code: 'H1-H4',       sub_room_ids: ['hall-1','hall-2','hall-3','hall-4'], is_combo_room: true, is_active: true, conflicting_room_ids: ['hall-1','hall-2','hall-3','hall-4'] },

  { id: 'hall-5',                  name: 'Hall 5',                  max_capacity: 3700, square_footage: 48255, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level Four',  item_code: 'H5',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'hall-6',                  name: 'Hall 6',                  max_capacity: 3700, square_footage: 48760, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level Four',  item_code: 'H6',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'hall-7',                  name: 'Hall 7',                  max_capacity: 3700, square_footage: 48555, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level Four',  item_code: 'H7',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'halls-l4',                name: 'Level 4 Halls total',     max_capacity:11200, square_footage:145570, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level Four',  item_code: 'H5-H7',       sub_room_ids: ['hall-5','hall-6','hall-7'],          is_combo_room: true, is_active: true, conflicting_room_ids: ['hall-5','hall-6','hall-7'] },
  { id: 'event-deck-open',         name: 'Event Deck - open air',   max_capacity: 4100, square_footage: 53820, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level Four',  item_code: 'ED-OPEN',     sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'event-deck-structure',    name: 'Event Deck - max structure size', max_capacity: 2500, square_footage: 32290, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Level Four', item_code: 'ED-STRUCT', sub_room_ids: [],           is_combo_room: false, is_active: true, conflicting_room_ids: []               },

  { id: 'e3-1',                    name: 'Meeting Room E3.1',       max_capacity:  100, square_footage:  1025, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.1',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-2',                    name: 'Meeting Room E3.2',       max_capacity:  100, square_footage:  1025, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.2',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-1-e3-2',               name: 'Meeting Room E3.1 + E3.2',max_capacity:  190, square_footage:  2045, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.1+E3.2', sub_room_ids: ['e3-1','e3-2'],  is_combo_room: true,  is_active: true, conflicting_room_ids: ['e3-1','e3-2']  },
  { id: 'e3-3',                    name: 'Meeting Room E3.3',       max_capacity:  110, square_footage:  1150, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.3',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-4',                    name: 'Meeting Room E3.4',       max_capacity:  110, square_footage:  1150, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.4',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-5',                    name: 'Meeting Room E3.5',       max_capacity:  120, square_footage:  1240, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.5',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-6',                    name: 'Meeting Room E3.6',       max_capacity:  120, square_footage:  1240, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.6',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-7',                    name: 'Meeting Room E3.7',       max_capacity:  150, square_footage:  1615, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.7',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-8',                    name: 'Meeting Room E3.8',       max_capacity:   80, square_footage:   895, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.8',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-9',                    name: 'Meeting Room E3.9',       max_capacity:  150, square_footage:  1605, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.9',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e3-10',                   name: 'Meeting Room E3.10',      max_capacity:  110, square_footage:  1225, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Three', item_code: 'E3.10',     sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },

  { id: 'e5-1',                    name: 'Meeting Room E5.1',       max_capacity:   60, square_footage:   700, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.1',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-2',                    name: 'Meeting Room E5.2',       max_capacity:  110, square_footage:  1185, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.2',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-3',                    name: 'Meeting Room E5.3',       max_capacity:  110, square_footage:  1185, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.3',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-2-e5-3',               name: 'Meeting Room E5.2 + E5.3',max_capacity:  220, square_footage:  2380, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.2+E5.3', sub_room_ids: ['e5-2','e5-3'],  is_combo_room: true,  is_active: true, conflicting_room_ids: ['e5-2','e5-3']  },
  { id: 'e5-4',                    name: 'Meeting Room E5.4',       max_capacity:  110, square_footage:  1165, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.4',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-5',                    name: 'Meeting Room E5.5',       max_capacity:  110, square_footage:  1175, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.5',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-4-e5-5',               name: 'Meeting Room E5.4 + E5.5',max_capacity:  220, square_footage:  2380, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.4+E5.5', sub_room_ids: ['e5-4','e5-5'],  is_combo_room: true,  is_active: true, conflicting_room_ids: ['e5-4','e5-5']  },
  { id: 'e5-6',                    name: 'Meeting Room E5.6',       max_capacity:   70, square_footage:   700, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.6',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-7',                    name: 'Meeting Room E5.7',       max_capacity:  140, square_footage:  1455, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.7',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-8',                    name: 'Meeting Room E5.8',       max_capacity:   90, square_footage:  1000, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.8',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-9',                    name: 'Meeting Room E5.9',       max_capacity:  110, square_footage:  1165, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.9',      sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'e5-10',                   name: 'Meeting Room E5.10',      max_capacity:  140, square_footage:  1475, venue_id: V_EXHB, venue_name: N_EXHB, room_group: 'Exhibition Mezzanine Level Five',  item_code: 'E5.10',     sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },

  { id: 'ec',                      name: 'Entertainment Centre',    max_capacity: 8000, square_footage:     0, venue_id: V_TTEC, venue_name: N_TTEC, room_group: 'Main',        item_code: 'EC',          sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'fr-1',                    name: 'Function Room 1',         max_capacity:  360, square_footage:  3500, venue_id: V_TTEC, venue_name: N_TTEC, room_group: 'Level Three', item_code: 'FR1',         sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
  { id: 'fr-2',                    name: 'Function Room 2',         max_capacity:  340, square_footage:  3280, venue_id: V_TTEC, venue_name: N_TTEC, room_group: 'Level Four',  item_code: 'FR2',         sub_room_ids: [],               is_combo_room: false, is_active: true, conflicting_room_ids: []               },
]

const ATOMIC_ROOMS = ROOMS.filter(r => !r.is_combo_room && r.is_active && r.max_capacity > 0)
  .sort((a, b) => a.max_capacity - b.max_capacity || a.id.localeCompare(b.id))
const LARGEST_ATOMIC = ATOMIC_ROOMS[ATOMIC_ROOMS.length - 1]


const FUNCTION_TEMPLATES: Record<string, Array<[string, number, number, number, boolean]>> = {
  'Conference':     [['Reception', 8,   1.5, 1.0,  false], ['Ceremony',   9,  4.0, 1.0,  false], ['Dinner',   13, 2.0, 0.6, false]],
  'Exhibition':     [['Setup',     7,   3.0, 0.0,  false], ['Breakout',   10, 8.0, 1.0,  false], ['Reception',18, 2.0, 0.3, false]],
  'Concert':        [['Reception', 18,  1.0, 0.2,  false], ['Performance',19, 3.0, 1.0,  true ], ['Setup',    23, 3.0, 0.0, false]],
  'Trade Show':     [['Setup',     7,   3.0, 0.0,  false], ['Breakout',   9,  8.0, 1.0,  false], ['Dinner',   18, 3.5, 0.3, false]],
  'Gala Dinner':    [['Setup',     13,  3.0, 0.0,  false], ['Reception',  18, 1.0, 1.0,  false], ['Dinner',   19, 4.0, 1.0, false]],
  'Corporate':      [['Meeting',   8,   4.0, 1.0,  false], ['Dinner',     12, 1.5, 1.0,  false], ['Workshop', 14, 3.0, 1.0, false]],
  'Sporting Event': [['Reception', 10,  2.0, 0.3,  false], ['Performance',12, 6.0, 1.0,  true ], ['Reception',18, 2.0, 0.4, false]],
  'Festival':       [['Reception', 9,   1.5, 0.3,  false], ['Performance',11, 8.0, 1.0,  true ], ['Breakout', 10, 6.0, 0.7, false]],
}

const SERIES_DEFS = [
  { id: 'ser-001', name: 'Salesforce World Tour',      uid: 'SWT',  type: 'Conference',     attendance: 11500, days: 1 },
  { id: 'ser-002', name: 'AnimeCon Sydney',             uid: 'AC',   type: 'Festival',       attendance:  7500, days: 3 },
  { id: 'ser-003', name: 'Sydney Tech Summit',          uid: 'STS',  type: 'Conference',     attendance:  3200, days: 3 },
  { id: 'ser-004', name: 'ICC Annual Gala',             uid: 'IAG',  type: 'Gala Dinner',    attendance:   600, days: 1 },
  { id: 'ser-005', name: 'Medical Congress Australia',  uid: 'MCA',  type: 'Conference',     attendance:  2700, days: 4 },
  { id: 'ser-006', name: 'Sydney Film Festival',        uid: 'SFF',  type: 'Concert',        attendance:  2200, days: 1 },
  { id: 'ser-007', name: 'National Trade Expo',         uid: 'NTE',  type: 'Trade Show',     attendance:  5000, days: 3 },
  { id: 'ser-008', name: 'Corporate Leadership Forum',  uid: 'CLF',  type: 'Corporate',      attendance:   400, days: 2 },
  { id: 'ser-009', name: 'eSports Championship',        uid: 'ESC',  type: 'Sporting Event', attendance:  9000, days: 3 },
  { id: 'ser-010', name: 'Luxury Expo',                 uid: 'LXE',  type: 'Exhibition',     attendance:  3200, days: 3 },
  { id: 'ser-011', name: 'Food & Beverage Expo',        uid: 'FBE',  type: 'Exhibition',     attendance:  3900, days: 3 },
  { id: 'ser-012', name: 'Health & Wellness Summit',    uid: 'HWS',  type: 'Conference',     attendance:  1700, days: 2 },
  { id: 'ser-013', name: 'Architecture & Design Show',  uid: 'ADS',  type: 'Exhibition',     attendance:  2500, days: 3 },
  { id: 'ser-014', name: 'Startup Showcase',            uid: 'SSC',  type: 'Corporate',      attendance:   900, days: 2 },
  { id: 'ser-015', name: 'Government Innovation Forum', uid: 'GIF',  type: 'Conference',     attendance:   700, days: 2 },
]

const ONEOFF_EVENT_DEFS: Array<{ name: string; type: string; baseAttendance: number; days: number; monthRange: [number, number] }> = [
  { name: 'International Auto Show',         type: 'Exhibition',     baseAttendance: 14500, days: 4, monthRange: [8,  8]  },
  { name: 'Rugby League Grand Final Fan Day', type: 'Sporting Event', baseAttendance: 10500, days: 1, monthRange: [9, 10]  },
  { name: 'Pop Music Arena Concert',          type: 'Concert',        baseAttendance: 10000, days: 1, monthRange: [4,  5]  },
  { name: 'AI & Machine Learning Summit',     type: 'Conference',     baseAttendance:  2200, days: 3, monthRange: [7,  7]  },
  { name: 'HR Tech Conference',               type: 'Conference',     baseAttendance:  1050, days: 2, monthRange: [11, 11] },
  { name: 'Renewable Energy Expo',            type: 'Exhibition',     baseAttendance:  3100, days: 3, monthRange: [11, 11] },
  { name: 'Classic Car Show',                 type: 'Exhibition',     baseAttendance:  5600, days: 3, monthRange: [9,  9]  },
  { name: 'Mining & Resources Summit',        type: 'Conference',     baseAttendance:  1800, days: 3, monthRange: [10, 10] },
  { name: 'Supply Chain & Logistics Expo',    type: 'Trade Show',     baseAttendance:  4000, days: 3, monthRange: [10, 10] },
  { name: 'Fintech Summit Asia Pacific',      type: 'Conference',     baseAttendance:  2000, days: 3, monthRange: [9,  9]  },
  { name: 'Defence & Security Expo',          type: 'Trade Show',     baseAttendance:  3600, days: 3, monthRange: [11, 11] },
  { name: 'Electronic Music Festival',        type: 'Concert',        baseAttendance:  5800, days: 1, monthRange: [11, 11] },
  { name: 'Cybersecurity Conference',         type: 'Conference',     baseAttendance:  1200, days: 2, monthRange: [7,  7]  },
  { name: 'Wedding Expo Sydney',              type: 'Exhibition',     baseAttendance:  3700, days: 2, monthRange: [4,  4]  },
  { name: 'Property Investment Summit',       type: 'Conference',     baseAttendance:   950, days: 1, monthRange: [5,  5]  },
  { name: 'Aged Care & Disability Expo',      type: 'Exhibition',     baseAttendance:  2900, days: 2, monthRange: [8,  8]  },
  { name: 'Nursing & Midwifery Conference',   type: 'Conference',     baseAttendance:  1950, days: 3, monthRange: [7,  7]  },
  { name: 'Education Technology Expo',        type: 'Exhibition',     baseAttendance:  2300, days: 2, monthRange: [9,  9]  },
  { name: 'Biotech Innovation Forum',         type: 'Conference',     baseAttendance:  1300, days: 2, monthRange: [7,  7]  },
  { name: 'Jewellery Fair International',     type: 'Exhibition',     baseAttendance:  4700, days: 3, monthRange: [8,  8]  },
]

const ICC_STAFF = [
  { id: 'u-001', name: 'Alice Chen',    email: 'a.chen@icc.com.au'    },
  { id: 'u-002', name: 'Ben Kim',       email: 'b.kim@icc.com.au'     },
  { id: 'u-003', name: 'Chloe Tan',     email: 'c.tan@icc.com.au'     },
  { id: 'u-004', name: 'David Nguyen',  email: 'd.nguyen@icc.com.au'  },
  { id: 'u-005', name: 'Emma Roberts',  email: 'e.roberts@icc.com.au' },
]

const TASK_TYPES   = ['Reminder', 'Action', 'Follow-up']
const TASK_TITLES  = [
  'Confirm catering numbers',
  'Send AV brief to tech team',
  'Finalise floor plan',
  'Brief security team',
  'Confirm speaker requirements',
  'Arrange exhibitor pack-in schedule',
  'Send logistics brief',
  'Confirm VIP access list',
  'Organise volunteer briefing',
  'Review crowd management plan',
  'Confirm wifi allocation',
  'Brief registration team',
  'Finalise menu selection',
  'Confirm table plan with client',
  'Arrange media access credentials',
]

function pad2(n: number): string { return String(n).padStart(2, '0') }

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function toTstz(d: Date): string {
  return `${toDateStr(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00+10`
}

function toTimeStr(hour: number, minute = 0): string {
  return `${pad2(hour % 24)}:${pad2(minute)}`
}

function scaleAttendance(base: number, year: number): number {
  const yearsBack = 2026 - year
  const factor    = Math.pow(0.92 + faker.number.float({ min: 0, max: 0.08 }), yearsBack)
  return Math.max(50, Math.round(base * factor))
}

function randInt(min: number, max: number): number {
  return faker.number.int({ min, max })
}

function esc(s: string | null): string {
  if (s === null) return 'null'
  return `'${s.replace(/'/g, "''")}'`
}

function escBool(b: boolean): string { return b ? 'true' : 'false' }

function generateRooms(): Room[] {
  return ROOMS
}

function pickRoomForAttendance(attendance: number): Room {
  const qualifying = ATOMIC_ROOMS.filter(r => r.max_capacity >= attendance)
  return qualifying[0] ?? LARGEST_ATOMIC
}

function generateSeries(): Series[] {
  return SERIES_DEFS.map(s => ({
    series_id:          s.id,
    name:               s.name,
    unique_id:          `${s.uid}-RECURRING`,
    announce_date_time: '2022-01-01 00:00:00+00',
    on_sale_date_time:  '2022-03-01 00:00:00+00',
  }))
}

function generateEvents(): VenueEvent[] {
  const events: VenueEvent[] = []
  const years = [2023, 2024, 2025, 2026]
  let   idx   = 1

  for (const year of years) {
    for (const s of SERIES_DEFS) {
      const etEntry = EVENT_TYPES.find(et => et.name === s.type)!
      const month   = randInt(3, 11)
      const day     = randInt(1, 20)
      const start   = new Date(year, month - 1, day, 8, 0, 0)
      const end     = new Date(year, month - 1, day + s.days - 1, 18, 0, 0)
      const att     = scaleAttendance(s.attendance, year)

      events.push({
        event_id:                  `evt-${String(idx).padStart(3, '0')}`,
        name:                      `${s.name} ${year}`,
        start_date_time:           toTstz(start),
        end_date_time:             toTstz(end),
        number_of_event_days:      s.days,
        event_type_id:             etEntry.id,
        event_type_name:           etEntry.name,
        estimated_total_attendance: att,
        series_id:                 s.id,
        is_tentative:              false,
        is_definite:               true,
      })
      idx++
    }
  }

  for (const year of years) {
    for (const def of ONEOFF_EVENT_DEFS) {
      const etEntry = EVENT_TYPES.find(et => et.name === def.type)!
      let month   = randInt(def.monthRange[0], def.monthRange[1])
      let day     = randInt(1, 20)

      if (events.length > 0 && faker.number.float({ min: 0, max: 1 }) < 0.3) {
        const overlap = events[randInt(0, events.length - 1)]
        const overlapDate = new Date(overlap.start_date_time.slice(0, 10))
        month = overlapDate.getMonth() + 1
        day   = overlapDate.getDate()
      }

      const start   = new Date(year, month - 1, day, 8, 0, 0)
      const end     = new Date(year, month - 1, day + def.days - 1, 18, 0, 0)
      const att     = scaleAttendance(def.baseAttendance, year)

      events.push({
        event_id:                  `evt-${String(idx).padStart(3, '0')}`,
        name:                      `${def.name} ${year}`,
        start_date_time:           toTstz(start),
        end_date_time:             toTstz(end),
        number_of_event_days:      def.days,
        event_type_id:             etEntry.id,
        event_type_name:           etEntry.name,
        estimated_total_attendance: att,
        series_id:                 null,
        is_tentative:              false,
        is_definite:               true,
      })
      idx++
    }
  }

  return events
}

function generateFunctions(events: VenueEvent[]): VenueFunction[] {
  const fns:  VenueFunction[] = []
  let   fidx = 1

  for (const evt of events) {
    const templates = FUNCTION_TEMPLATES[evt.event_type_name] ?? FUNCTION_TEMPLATES['Conference']

    for (let i = 0; i < templates.length; i++) {
      const [ftName, startHour, durationHours, attFraction, isPerf] = templates[i]
      const ftEntry = FUNCTION_TYPES.find(ft => ft.name === ftName)!

      const functionDay = i % evt.number_of_event_days
      const baseDate    = new Date(evt.start_date_time.slice(0, 10))
      baseDate.setDate(baseDate.getDate() + functionDay)
      const evtDate     = toDateStr(baseDate)

      const timeOffset     = faker.number.float({ min: -1, max: 1 })
      const durationOffset = faker.number.float({ min: -0.5, max: 0.5 })
      const adjStart       = Math.max(0, Math.min(23, startHour + timeOffset))
      const adjDuration    = Math.max(0.5, durationHours + durationOffset)

      const startTotalMin = Math.round(adjStart * 60)
      const startHourClamped = Math.floor(startTotalMin / 60) % 24
      const startMinute      = startTotalMin % 60
      const att              = Math.max(0, Math.round(evt.estimated_total_attendance * attFraction))

      const endTotalMin = Math.round((adjStart + adjDuration) * 60)
      const endHour     = Math.floor(endTotalMin / 60) % 24
      const endMinute   = endTotalMin % 60

      const startDt = `${evtDate} ${toTimeStr(startHourClamped, startMinute)}:00+10`
      const endDt   = `${evtDate} ${toTimeStr(endHour, endMinute)}:00+10`

      const room = pickRoomForAttendance(att)

      fns.push({
        function_id:       `fn-${String(fidx).padStart(3, '0')}`,
        event_id:          evt.event_id,
        name:              `${ftName} — ${evt.name}`,
        date:              evtDate,
        start_time:        toTimeStr(startHourClamped, startMinute),
        end_time:          toTimeStr(endHour, endMinute),
        start_date_time:   startDt,
        end_date_time:     endDt,
        number_of_hours:   Math.round(adjDuration * 100) / 100,
        expected_attendance: att,
        is_performance:    isPerf,
        function_type_id:  ftEntry.id,
        function_type_name: ftEntry.name,
        room_id:           room.id,
        room_name:         room.name,
        venue_id:          room.venue_id,
        venue_name:        room.venue_name,
        event_type_name:   evt.event_type_name,
      })
      fidx++
    }
  }

  return fns
}

function generateBookedSpaces(events: VenueEvent[], functions: VenueFunction[]): BookedSpace[] {
  const roomById = new Map(ROOMS.map(r => [r.id, r]))
  const firstFnByEvent = new Map<string, VenueFunction>()
  for (const fn of functions) {
    if (!firstFnByEvent.has(fn.event_id)) firstFnByEvent.set(fn.event_id, fn)
  }

  return events.map((evt, i) => {
    const setup = ['Theatre', 'Open Floor', 'Banquet', 'Arena', 'Classroom', 'Boardroom'][i % 6]
    const fn    = firstFnByEvent.get(evt.event_id)
    const room  = fn?.room_id ? roomById.get(fn.room_id) ?? null : null

    return {
      id:             `bs-${String(i + 1).padStart(3, '0')}`,
      event_id:       evt.event_id,
      room_id:        room?.id ?? null,
      room_name:      room?.name ?? 'TBA',
      room_setup:     setup,
      venue_id:       room?.venue_id ?? VENUE_ID,
      attendance:     evt.estimated_total_attendance,
      room_capacity:  room?.max_capacity ?? null,
      square_footage: room?.square_footage ?? null,
      option_number:  1,
      start_date:     evt.start_date_time.slice(0, 10),
      end_date:       evt.end_date_time.slice(0, 10),
      is_all_day:     false,
      start_time:     '08:00',
      end_time:       '22:00',
      booked_status:  'definite',
      usage_type:     'event',
      number_of_hours: evt.number_of_event_days * 10,
      is_invoiced:    true,
    }
  })
}

function generateTasks(events: VenueEvent[]): Task[] {
  const tasks: Task[] = []
  const slice  = events.slice(0, 40)

  let tidx = 1
  for (const evt of slice) {
    for (let t = 0; t < 2; t++) {
      const staff    = ICC_STAFF[randInt(0, ICC_STAFF.length - 1)]
      const dueDate  = new Date(evt.start_date_time.slice(0, 10))
      dueDate.setDate(dueDate.getDate() - randInt(7, 30))

      tasks.push({
        id:           `tsk-${String(tidx).padStart(3, '0')}`,
        title:        `${TASK_TITLES[randInt(0, TASK_TITLES.length - 1)]} for ${evt.name}`,
        task_type:    TASK_TYPES[randInt(0, TASK_TYPES.length - 1)],
        due_date:     toDateStr(dueDate),
        is_completed: dueDate < new Date('2026-01-01'),
        event_id:     evt.event_id,
        event_name:   evt.name,
        assigned_to:  JSON.stringify([{ id: staff.id, name: staff.name, email: staff.email }]),
      })
      tidx++
    }
  }

  return tasks
}

function sqlVal(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean')        return escBool(v)
  if (typeof v === 'number')         return String(v)
  if (typeof v === 'string')         return esc(v)
  if (Array.isArray(v)) {
    return `'{${v.map(x => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}'`
  }
  return esc(String(v))
}

function toInsert(table: string, columns: string[], rows: object[], conflictCol: string): string {
  if (rows.length === 0) return ''
  const vals = rows.map(r =>
    '    (' + columns.map(c => sqlVal((r as Record<string, unknown>)[c])).join(', ') + ')'
  ).join(',\n')
  return [
    `insert into public.${table} (`,
    `    ${columns.join(', ')}`,
    `) values`,
    vals,
    `on conflict (${conflictCol}) do nothing;\n`,
  ].join('\n')
}

const ML_FEATURES_SQL = `
insert into public.venueops_ml_features (
    event_id, function_id, time_slice_index,
    entry_peak_flag, exit_peak_flag, meal_window_flag,
    day_of_week, month, simultaneous_event_count, total_venue_attendance_same_time,
    event_type, expected_attendance, function_type,
    function_start_datetime, function_end_datetime,
    room_count, total_sqm, room_capacity,
    target_staff_count, target_role
)
select
    f.event_id,
    f.function_id,
    gs.n                                                          as time_slice_index,
    (gs.n < 2)                                                    as entry_peak_flag,
    (gs.n >= greatest(0, floor(f.number_of_hours * 2)::int - 2)) as exit_peak_flag,
    (f.function_type_name in ('Dinner', 'Reception'))             as meal_window_flag,
    extract(dow   from f.start_date_time)::int                    as day_of_week,
    extract(month from f.start_date_time)::int                    as month,
    (select count(*) from public.venueops_events e2
     where e2.event_id != f.event_id
       and e2.start_date_time < f.end_date_time
       and e2.end_date_time   > f.start_date_time)::int + 1       as simultaneous_event_count,
    (select coalesce(sum(e2.estimated_total_attendance), 0)
     from public.venueops_events e2
     where e2.start_date_time < f.end_date_time
       and e2.end_date_time   > f.start_date_time)::int           as total_venue_attendance_same_time,
    f.event_type_name                                             as event_type,
    f.expected_attendance,
    f.function_type_name                                          as function_type,
    f.start_date_time                                             as function_start_datetime,
    f.end_date_time                                               as function_end_datetime,
    coalesce((
      select count(distinct bs.room_id)::int
      from public.venueops_booked_spaces bs
      where bs.event_id = f.event_id and bs.room_id is not null
    ), 1)                                                         as room_count,
    coalesce(round(r.square_footage / 10.764)::int, 0)            as total_sqm,
    coalesce(r.max_capacity, 0)                                   as room_capacity,
    greatest(1, round(
      (f.expected_attendance / 50.0)
      * (0.6 + random() * 0.8)
      * case when f.event_type_name = 'Concert' then 1.3
             when f.event_type_name = 'Gala Dinner' then 1.2
             else 1.0 end
    )::int)                                                       as target_staff_count,
    'Usher'                                                       as target_role
from public.venueops_functions f
join public.venueops_events e on e.event_id = f.event_id
left join public.venueops_rooms r on r.id = f.room_id
cross join generate_series(0, greatest(0, floor(f.number_of_hours * 2)::int - 1)) as gs(n)
where f.expected_attendance > 0

union all

select
    f.event_id, f.function_id, gs.n,
    (gs.n < 2),
    (gs.n >= greatest(0, floor(f.number_of_hours * 2)::int - 2)),
    false,
    extract(dow from f.start_date_time)::int, extract(month from f.start_date_time)::int,
    (select count(*) from public.venueops_events e2 where e2.event_id != f.event_id and e2.start_date_time < f.end_date_time and e2.end_date_time > f.start_date_time)::int + 1,
    (select coalesce(sum(e2.estimated_total_attendance), 0) from public.venueops_events e2 where e2.start_date_time < f.end_date_time and e2.end_date_time > f.start_date_time)::int, f.event_type_name, f.expected_attendance, f.function_type_name,
    f.start_date_time, f.end_date_time,
    coalesce((select count(distinct bs.room_id)::int from public.venueops_booked_spaces bs where bs.event_id = f.event_id and bs.room_id is not null), 1),
    coalesce(round(r.square_footage / 10.764)::int, 0),
    coalesce(r.max_capacity, 0),
    greatest(1, round((f.expected_attendance / 100.0) * (0.6 + random() * 0.8) * case when f.event_type_name = 'Concert' then 1.3 when f.event_type_name = 'Gala Dinner' then 1.2 else 1.0 end)::int),
    'Security'
from public.venueops_functions f
join public.venueops_events e on e.event_id = f.event_id
left join public.venueops_rooms r on r.id = f.room_id
cross join generate_series(0, greatest(0, floor(f.number_of_hours * 2)::int - 1)) as gs(n)
where f.expected_attendance > 0

union all

select
    f.event_id, f.function_id, gs.n,
    (gs.n < 2),
    (gs.n >= greatest(0, floor(f.number_of_hours * 2)::int - 2)),
    (f.function_type_name in ('Dinner', 'Reception')),
    extract(dow from f.start_date_time)::int, extract(month from f.start_date_time)::int,
    (select count(*) from public.venueops_events e2 where e2.event_id != f.event_id and e2.start_date_time < f.end_date_time and e2.end_date_time > f.start_date_time)::int + 1,
    (select coalesce(sum(e2.estimated_total_attendance), 0) from public.venueops_events e2 where e2.start_date_time < f.end_date_time and e2.end_date_time > f.start_date_time)::int, f.event_type_name, f.expected_attendance, f.function_type_name,
    f.start_date_time, f.end_date_time,
    coalesce((select count(distinct bs.room_id)::int from public.venueops_booked_spaces bs where bs.event_id = f.event_id and bs.room_id is not null), 1),
    coalesce(round(r.square_footage / 10.764)::int, 0),
    coalesce(r.max_capacity, 0),
    greatest(1, round((f.expected_attendance / 30.0) * (0.6 + random() * 0.8) * case when f.event_type_name = 'Concert' then 1.3 when f.event_type_name = 'Gala Dinner' then 1.2 else 1.0 end)::int),
    'Food Staff'
from public.venueops_functions f
join public.venueops_events e on e.event_id = f.event_id
left join public.venueops_rooms r on r.id = f.room_id
cross join generate_series(0, greatest(0, floor(f.number_of_hours * 2)::int - 1)) as gs(n)
where f.function_type_name in ('Dinner', 'Reception') and f.expected_attendance > 0

union all

select
    f.event_id, f.function_id, gs.n,
    (gs.n < 2),
    (gs.n >= greatest(0, floor(f.number_of_hours * 2)::int - 2)),
    false,
    extract(dow from f.start_date_time)::int, extract(month from f.start_date_time)::int,
    (select count(*) from public.venueops_events e2 where e2.event_id != f.event_id and e2.start_date_time < f.end_date_time and e2.end_date_time > f.start_date_time)::int + 1,
    (select coalesce(sum(e2.estimated_total_attendance), 0) from public.venueops_events e2 where e2.start_date_time < f.end_date_time and e2.end_date_time > f.start_date_time)::int, f.event_type_name, f.expected_attendance, f.function_type_name,
    f.start_date_time, f.end_date_time,
    coalesce((select count(distinct bs.room_id)::int from public.venueops_booked_spaces bs where bs.event_id = f.event_id and bs.room_id is not null), 1),
    coalesce(round(r.square_footage / 10.764)::int, 0),
    coalesce(r.max_capacity, 0),
    greatest(1, round((f.expected_attendance / 500.0) * (0.6 + random() * 0.8) * case when f.event_type_name = 'Concert' then 1.3 when f.event_type_name = 'Gala Dinner' then 1.2 else 1.0 end)::int),
    'Supervisor'
from public.venueops_functions f
join public.venueops_events e on e.event_id = f.event_id
left join public.venueops_rooms r on r.id = f.room_id
cross join generate_series(0, greatest(0, floor(f.number_of_hours * 2)::int - 1)) as gs(n)
where f.expected_attendance > 0;
`

export {
  EVENT_TYPES,
  FUNCTION_TYPES,
  ROOMS,
  generateRooms,
  generateSeries,
  generateEvents,
  generateFunctions,
  generateBookedSpaces,
  generateTasks,
}

export function generateAll(seed = 12345) {
  faker.seed(seed)
  const rooms        = generateRooms()
  const series       = generateSeries()
  const events       = generateEvents()
  const functions    = generateFunctions(events)
  const bookedSpaces = generateBookedSpaces(events, functions)
  const tasks        = generateTasks(events)
  return { rooms, series, events, functions, bookedSpaces, tasks }
}

function main() {
  const rooms        = generateRooms()
  const series       = generateSeries()
  const events       = generateEvents()
  const functions    = generateFunctions(events)
  const bookedSpaces = generateBookedSpaces(events, functions)
  const tasks        = generateTasks(events)

  const lines: string[] = []

  lines.push(`-- Event Types`)
  lines.push(toInsert('venueops_event_types', ['id', 'name'], EVENT_TYPES, 'id'))

  lines.push(`-- Function Types`)
  lines.push(toInsert('venueops_function_types',
    ['id', 'name', 'room_setup', 'show_on_calendar', 'is_performance'],
    FUNCTION_TYPES, 'id'))

  lines.push(`-- Rooms`)
  lines.push(toInsert('venueops_rooms',
    ['id','name','max_capacity','square_footage','venue_id','venue_name',
     'room_group','item_code','sub_room_ids','is_combo_room','is_active',
     'conflicting_room_ids'],
    rooms, 'id'))

  lines.push(`-- Series`)
  lines.push(toInsert('venueops_series',
    ['series_id', 'name', 'unique_id', 'announce_date_time', 'on_sale_date_time'],
    series, 'series_id'))

  lines.push(`-- Events`)
  lines.push(toInsert('venueops_events',
    ['event_id','name','start_date_time','end_date_time','number_of_event_days',
     'event_type_id','event_type_name','estimated_total_attendance','series_id',
     'is_tentative','is_definite'],
    events, 'event_id'))

  lines.push(`-- Functions`)
  lines.push(toInsert('venueops_functions',
    ['function_id','event_id','name','date','start_time','end_time',
     'start_date_time','end_date_time','number_of_hours','expected_attendance',
     'is_performance','function_type_id','function_type_name',
     'room_id','room_name','venue_id','venue_name','event_type_name'],
    functions, 'function_id'))

  lines.push(`-- Booked Spaces`)
  lines.push(toInsert('venueops_booked_spaces',
    ['id','event_id','room_id','room_name','room_setup','venue_id',
     'attendance','room_capacity','square_footage','option_number',
     'start_date','end_date','is_all_day','start_time','end_time',
     'booked_status','usage_type','number_of_hours','is_invoiced'],
    bookedSpaces, 'id'))

  lines.push(`-- Tasks`)
  lines.push(toInsert('venueops_tasks',
    ['id','title','task_type','due_date','is_completed','event_id','event_name','assigned_to'],
    tasks, 'id'))

  lines.push(`-- ML Features`)
  lines.push(ML_FEATURES_SQL)

  process.stdout.write(lines.join('\n'))
}

const isDirectRun =
  typeof process !== 'undefined' &&
  !!process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href

if (isDirectRun) {
  main()
}
