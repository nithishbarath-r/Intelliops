/**
 * Natural-language questions ("which shipments are at risk today?").
 *
 * Live mode: grounded answer from a foundation model on SAP AI Core's
 * generative AI hub (destination `AICORE`, chat-completions deployment).
 * The model only sees a JSON snapshot queried from HANA Cloud, so it cannot
 * invent shipments. Joule Studio can expose this as a custom skill by
 * calling the CAP `ask` action.
 *
 * Mock mode: deterministic intent rules over the same snapshot.
 */
const { settings } = require('../lib/config');
const { callDestination } = require('../lib/http');

const pct = (p) => `${Math.round(Number(p) * 100)}%`;
const mins = (m) => (m == null ? 'n/a' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

function mockAnswer(question, snapshot) {
  const q = question.toLowerCase();
  const byNumber = snapshot.forecasts.find((f) => q.includes(f.shipment.toLowerCase()));

  if (byNumber) {
    const notif = snapshot.notifications.find((n) => n.shipment === byNumber.shipment);
    return {
      answer:
        `${byNumber.shipment} (${byNumber.route}, driver ${byNumber.driver}) is at ${byNumber.temperature ?? '–'}°C. ` +
        `24h excursion risk is ${pct(byNumber.probability)} (${byNumber.level}).` +
        (byNumber.timeToBreachMin != null ? ` Time to breach: ${mins(byNumber.timeToBreachMin)}.` : '') +
        (notif ? ` S/4HANA notification ${notif.number} is open for ${notif.equipment}.` : ''),
      shipments: [byNumber.shipment],
    };
  }

  if (/notification|maintenance|s\/4|work order|order/.test(q)) {
    if (!snapshot.notifications.length) return { answer: 'No maintenance notifications have been raised yet.', shipments: [] };
    return {
      answer: `Open maintenance notifications: ${snapshot.notifications
        .map((n) => `${n.number} for ${n.equipment} (${n.shipment})`)
        .join('; ')}.`,
      shipments: snapshot.notifications.map((n) => n.shipment),
    };
  }

  if (/how many|count|number of/.test(q) && /excursion|breach|alert/.test(q)) {
    return { answer: `There ${snapshot.openExcursions === 1 ? 'is' : 'are'} ${snapshot.openExcursions} open excursion${snapshot.openExcursions === 1 ? '' : 's'} right now.`, shipments: [] };
  }

  if (/risk|danger|breach|excursion|hot|warm|today|attention|which|worst/.test(q)) {
    const atRisk = snapshot.forecasts.filter((f) => f.level !== 'LOW');
    if (!atRisk.length) {
      return { answer: 'No shipment is above low risk for the next 24 hours.', shipments: [] };
    }
    return {
      answer:
        `${atRisk.length} shipment${atRisk.length === 1 ? ' is' : 's are'} at risk in the next 24 hours: ` +
        atRisk
          .map((f) => `${f.shipment} (${f.route}) ${pct(f.probability)} ${f.level.toLowerCase()}${f.timeToBreachMin != null ? `, breach in ${mins(f.timeToBreachMin)}` : ''}`)
          .join('; ') +
        '.',
      shipments: atRisk.map((f) => f.shipment),
    };
  }

  return {
    answer: 'Try asking “Which shipments are at risk today?”, “Status of CN-24018” or “Show open maintenance notifications”.',
    shipments: [],
  };
}

async function ask(question, snapshot) {
  const cfg = settings().joule;

  if (cfg.mode !== 'live' || !cfg.deploymentId) {
    return { ...mockAnswer(question, snapshot), source: 'IntelliOps rules (mock)' };
  }

  const data = await callDestination(cfg.destination, {
    method: 'post',
    url: `/v2/inference/deployments/${cfg.deploymentId}/chat/completions?api-version=${cfg.apiVersion}`,
    headers: { 'AI-Resource-Group': cfg.resourceGroup, 'Content-Type': 'application/json' },
    data: {
      temperature: 0,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content:
            'You are the IntelliOps cold-chain assistant for vaccine logistics coordinators. ' +
            'Answer only from the JSON snapshot provided. Be brief (max 3 sentences), name shipment numbers, ' +
            'and never invent data. If the snapshot does not contain the answer, say so.',
        },
        { role: 'user', content: `Snapshot:\n${JSON.stringify(snapshot)}\n\nQuestion: ${question}` },
      ],
    },
  });

  const answer = data.choices?.[0]?.message?.content?.trim() || 'No answer returned.';
  const shipments = snapshot.forecasts.map((f) => f.shipment).filter((n) => answer.includes(n));
  return { answer, shipments, source: 'SAP AI Core · generative AI hub' };
}

module.exports = { ask, mockAnswer };
