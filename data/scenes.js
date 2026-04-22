// data/scenes.js — Published scenes (committed to git).
// Write your scenes in data/story-draft.js (local only, gitignored).
// When scenes are ready to ship, copy them here.
//
// Scene schema:
// {
//   id:        string           — unique id
//   type:      'ambient'|'story'— ambient: repeatable flavour; story: one-shot narrative
//   location:  string           — matches REST_ACTIVITIES id: bar|walk|movie|park|breakfast|exercise
//   weight:    number           — relative pick probability (higher = more frequent)
//   oneShot:   boolean          — if true, only shows once (stored in state.storyFlags)
//   condition: {
//     minDay:   number          — state.dayCount ≥ value
//     minFame:  number          — state.fame ≥ value
//     minLevel: number          — state.level ≥ value
//     flags:    string[]        — ALL of these must be in state.storyFlags
//     notFlags: string[]        — NONE of these must be in state.storyFlags
//   },
//   panels: [
//     { speaker: string, portrait: string (emoji), text: string }
//     // optional: choices: [{ label, outcomes, next }]  — index of next panel (null = end)
//   ],
//   outcomes: [
//     { type: 'set_flag',    flag: string }
//     { type: 'unlock_card', cardId: string }
//     { type: 'unlock_menu', menu: string }
//     { type: 'add_fame',    value: number }
//     { type: 'add_xp',      value: number }
//     { type: 'show_toast',  text: string }
//   ]
// }

export const SCENES = [];
