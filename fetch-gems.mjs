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

// ── Vendor price table (based on gem required_level) ─────────
function vendorCost(reqLevel) {
  const lvl = reqLevel || 1;
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

async function cargoQueryAll(label, params) {
  const LIMIT = 500;
  let offset = 0, results = [];
  process.stdout.write(`  Fetching ${label}...`);
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

  // Step 1: quest + vendor rewards
  const [questRows, vendorRows] = await Promise.all([
    cargoQueryAll('quest_rewards', {
      tables: 'quest_rewards',
      fields: 'quest_rewards._pageName=gem,quest_rewards.act,quest_rewards.quest,quest_rewards.quest_id,quest_rewards.classes',
      where: 'quest_rewards.act IS NOT NULL',
      order_by: 'quest_rewards.act ASC',
    }),
    cargoQueryAll('vendor_rewards', {
      tables: 'vendor_rewards',
      fields: 'vendor_rewards._pageName=gem,vendor_rewards.act,vendor_rewards.quest,vendor_rewards.quest_id,vendor_rewards.classes,vendor_rewards.npc',
      where: 'vendor_rewards.act IS NOT NULL',
      order_by: 'vendor_rewards.act ASC',
    }),
  ]);

  // Step 2: collect all unique gem page names
  const allKeys = [...new Set([
    ...questRows.map(r => r.gem),
    ...vendorRows.map(r => r.gem),
  ].filter(Boolean))];

  console.log(`  Found ${allKeys.length} unique gems, fetching item data...`);

  // Step 3: fetch from skill_gems (has primary_attribute) joined with items (has required_level)
  const skillGemRows = await cargoQueryAll('skill_gems', {
    tables: 'skill_gems,items',
    join_on: 'skill_gems._pageID=items._pageID',
    fields: 'skill_gems._pageName=gem,items.name=name,items.required_level=required_level,skill_gems.primary_attribute=primary_attribute,skill_gems.gem_tags=gem_tags',
  });

  const gemInfo = {};
  for (const row of skillGemRows) {
    if (!row.gem) continue;
    const attr = (row.primary_attribute || '').toLowerCase();
    let color = 'gen';
    if (attr === 'strength')          color = 'str';
    else if (attr === 'dexterity')    color = 'dex';
    else if (attr === 'intelligence') color = 'int';
    const tags = (row.gem_tags || '').toLowerCase();
    gemInfo[row.gem] = {
      name: row.name || row.gem,
      requiredLevel: parseInt(row.required_level) || 1,
      isSupport: tags.includes('support'),
      color,
    };
  }
  console.log(`  Matched item data for ${Object.keys(gemInfo).length} gems ✓`);

  // Step 4: build maps
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

  // Step 5: merge into final gem list
  const gems = [];
  for (const key of allKeys) {
    const info = gemInfo[key] || { name: key, requiredLevel: 1, isSupport: false };
    const cost = vendorCost(info.requiredLevel);
    gems.push({
      key,
      name: info.name,
      requiredLevel: info.requiredLevel,
      isSupport: info.isSupport,
      color: info.color || 'gen',
      vendorCost: cost,
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
    gems,
  }, null, 2);

  await writeFile('gems.json', json, 'utf8');
  console.log(`\nDone! Wrote ${gems.length} gems to gems.json`);
  console.log(`File size: ${(json.length / 1024).toFixed(1)} KB`);

  // Quick sanity check
  const withLevel = gems.filter(g => g.requiredLevel > 1);
  console.log(`Gems with requiredLevel > 1: ${withLevel.length}`);
  if (withLevel.length === 0) {
    console.warn('\nWARNING: All gems have requiredLevel=1 — items table query may have failed!');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
