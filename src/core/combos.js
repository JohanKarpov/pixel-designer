// src/core/combos.js — Combo definitions and evaluation
// Combos are evaluated when the player modifies the planning queue.
// They apply multipliers and bonuses to rewards during the WORK phase.

// ─────────────────────────────────────────────────────────────
// Combo definitions
// ─────────────────────────────────────────────────────────────
//
// Each combo:
//   id          — unique key
//   label       — short display name shown in planning UI
//   description — full explanation of the effect
//   condition   — function(queue: CardDef[]) → { active: boolean, stacks?: number }
//   effect      — function(stacks: number) → ComboEffect
//
// ComboEffect shape:
//   incomeMultiplier  — multiplier applied to moneyPerGen rewards (default 1)
//   xpMultiplier      — multiplier applied to all XP rewards (default 1)
//   fameMultiplier    — multiplier applied to fame rewards (default 1)
//   bonusXpFlat       — flat XP added to each card completion (default 0)

export const COMBO_DEFINITIONS = [
    {
        id: 'gen_stack',
        label: 'Генерационный стак',
        description: '+25% к доходу за 3+ задачи с генерациями подряд, ещё +10% за каждую следующую',
        condition(queue) {
            // Count max consecutive run of cards with tag 'генерации'
            let maxRun = 0;
            let run = 0;
            for (const card of queue) {
                if ((card.tags || []).includes('генерации')) {
                    run++;
                    if (run > maxRun) maxRun = run;
                } else {
                    run = 0;
                }
            }
            if (maxRun >= 3) return { active: true, stacks: maxRun };
            return { active: false };
        },
        effect(stacks) {
            // stacks = max consecutive run length (≥3)
            // +25% base, +10% for each card beyond 3rd
            const bonus = 0.25 + (stacks - 3) * 0.10;
            return { incomeMultiplier: 1 + bonus };
        },
    },

    {
        id: 'promo_wave',
        label: 'Промо-волна',
        description: '2+ промо-карт: ×2 к известности, +25% к опыту за карты с тегом «насмотренность»',
        condition(queue) {
            const promoCount = queue.filter(c => (c.tags || []).includes('промо')).length;
            if (promoCount >= 2) return { active: true, stacks: promoCount };
            return { active: false };
        },
        effect(_stacks) {
            return {
                fameMultiplier: 2,
                // xpMultiplier only for 'насмотренность' cards — handled in executeCard
                promoWaveActive: true,
            };
        },
    },

    {
        id: 'hungry_researcher',
        label: 'Голодный исследователь',
        description: 'Не больше 1 задачи с генерациями в руке → ×2 к опыту',
        condition(queue) {
            // "В руке" here means: in the current hand (all drawn cards), not just queue.
            // We check the queue itself — if player picked ≤1 generation card.
            const genCount = queue.filter(c => (c.tags || []).includes('генерации')).length;
            if (genCount <= 1) return { active: true, stacks: 1 };
            return { active: false };
        },
        effect(_stacks) {
            return { xpMultiplier: 2 };
        },
    },
];

// ─────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────

/**
 * Evaluate all combos against the current queue.
 * Returns:
 *   activeComboIds  — array of active combo ids
 *   activeCombos    — array of { id, label, description, effect } for display
 *   merged          — merged ComboEffect object (multipliers multiplied, flats summed)
 */
export function evaluateCombos(queue) {
    const activeCombos = [];
    const merged = {
        incomeMultiplier: 1,
        xpMultiplier: 1,
        fameMultiplier: 1,
        bonusXpFlat: 0,
        promoWaveActive: false,
    };

    for (const combo of COMBO_DEFINITIONS) {
        const result = combo.condition(queue);
        if (!result.active) continue;

        const eff = combo.effect(result.stacks ?? 1);
        activeCombos.push({ id: combo.id, label: combo.label, description: combo.description, effect: eff });

        // Merge
        if (eff.incomeMultiplier) merged.incomeMultiplier *= eff.incomeMultiplier;
        if (eff.xpMultiplier)     merged.xpMultiplier     *= eff.xpMultiplier;
        if (eff.fameMultiplier)   merged.fameMultiplier   *= eff.fameMultiplier;
        if (eff.bonusXpFlat)      merged.bonusXpFlat      += eff.bonusXpFlat;
        if (eff.promoWaveActive)  merged.promoWaveActive   = true;
    }

    return { activeCombos, merged };
}
