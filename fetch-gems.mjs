/**
 * fetch-gems.mjs
 * 
 * Run once (or each new league) to regenerate gems.json:
 *   node fetch-gems.mjs
 * 
 * Requires Node 18+ (native fetch).
 * Output: gems.json  ← commit this file alongside index.html
 */

const API = 'https://www.poewiki.net/w/api.php';

// ── Vendor price table (based on gem required_level) ────────
function vendorCost(reqLevel) {
  const lvl = reqLevel || 1;
  if (lvl <= 3)  return { qty: 1, orb: 'Scroll of Wisdom' };
  if (lvl <= 7)  return { qty: 1, orb: 'Scroll of Wisdom' };
  if (lvl <= 15) return { qty: 1, orb: 'Orb of Transmutation' };
  if (lvl <= 27) return { qty: 1, orb: 'Orb of Alteration' };
  if (lvl <= 37) return { qty: 1, orb: 'Orb of Chance' };
  return           { qty: 1, orb: 'Orb of Alchemy' };
}

// ── Cargo query helper ────────────────────────────────────────
async function cargoQuery(params) {
  const url = new URL(API);
  url.searchParams.set('action', 'cargoquery');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  return (data.cargoquery || []).map(r => r.title);
}

async function cargoQueryAll(params) {
  const LIMIT = 500;
  let offset = 0, results = [];
  process.stdout.write(`  Fetching ${params.tables}...`);
  while (true) {
    const rows = await cargoQuery({ ...params, limit: LIMIT, offset });
    results = results.concat(rows);
    process.stdout.write(` ${results.length}`);
    if (rows.length < LIMIT) break;
    offset += LIMIT;
  }
  console.log(' ✓');
  return results;
}

function parseClasses(str) {
  if (!str) return [];
  return str.split(/[,;|\x00-\x1F]+/).map(s => s.trim()).filter(Boolean);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('Fetching gem data from poewiki.net...\n');

  const [questRows, vendorRows, itemRows] = await Promise.all([
    cargoQueryAll({
      tables: 'quest_rewards',
      fields: 'quest_rewards._pageName=gem,quest_rewards.act,quest_rewards.quest,quest_rewards.quest_id,quest_rewards.classes',
      where: 'quest_rewards.act IS NOT NULL',
      order_by: 'quest_rewards.act ASC',
    }),
    cargoQueryAll({
      tables: 'vendor_rewards',
      fields: 'vendor_rewards._pageName=gem,vendor_rewards.act,vendor_rewards.quest,vendor_rewards.quest_id,vendor_rewards.classes,vendor_rewards.npc',
      where: 'vendor_rewards.act IS NOT NULL',
      order_by: 'vendor_rewards.act ASC',
    }),
    cargoQueryAll({
      tables: 'items',
      fields: 'items._pageName=gem,items.name,items.required_level,items.tags',
      where: 'items.class_id="Active Skill Gem" OR items.class_id="Support Skill Gem"',
    }),
  ]);

  // Build lookup maps
  const gemInfo = {};
  for (const row of itemRows) {
    if (!row.gem) continue;
    gemInfo[row.gem] = {
      name: row.name || row.gem,
      requiredLevel: parseInt(row.required_level) || 1,
      isSupport: (row.tags || '').toLowerCase().includes('support'),
    };
  }

  const questMap = {};
  for (const row of questRows) {
    const g = row.gem; if (!g) continue;
    if (!questMap[g]) questMap[g] = [];
    questMap[g].push({
      act: parseInt(row.act) || 1,
      quest: row.quest || '',
      questId: row.quest_id || '',
      classes: parseClasses(row.classes),
    });
  }

  const vendorMap = {};
  for (const row of vendorRows) {
    const g = row.gem; if (!g) continue;
    if (!vendorMap[g]) vendorMap[g] = [];
    vendorMap[g].push({
      act: parseInt(row.act) || 1,
      quest: row.quest || '',
      questId: row.quest_id || '',
      npc: row.npc || '',
      classes: parseClasses(row.classes),
    });
  }

  // Merge into final gem list
  const allKeys = new Set([...Object.keys(questMap), ...Object.keys(vendorMap)]);
  const gems = [];

  for (const key of allKeys) {
    if (!key) continue;
    const info = gemInfo[key] || { name: key, requiredLevel: 1, isSupport: false };
    const cost = vendorCost(info.requiredLevel);

    gems.push({
      key,
      name: info.name,
      requiredLevel: info.requiredLevel,
      isSupport: info.isSupport,
      vendorCost: cost,            // { qty: 1, orb: "Orb of Alteration" }
      questRewards: questMap[key] || [],
      vendorRewards: vendorMap[key] || [],
    });
  }

  gems.sort((a, b) => a.name.localeCompare(b.name));

  // Write output
  const { writeFile } = await import('fs/promises');
  const json = JSON.stringify({ 
    generatedAt: new Date().toISOString(),
    count: gems.length,
    gems 
  }, null, 2);
  
  await writeFile('gems.json', json, 'utf8');
  console.log(`\nDone! Wrote ${gems.length} gems to gems.json`);
  console.log(`File size: ${(json.length / 1024).toFixed(1)} KB`);
}

main().catch(err => { console.error(err); process.exit(1); });
