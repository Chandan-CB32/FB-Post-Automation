import * as XLSX from 'xlsx';
import type { ParsedSheetRow, SheetParseResult } from '../types/library.js';

interface ColumnMappingRule {
  field: keyof ParsedSheetRow | 'ignored';
  patterns: RegExp[];
}

const COLUMN_RULES: ColumnMappingRule[] = [
  {
    field: 'externalId',
    patterns: [/^(id|#|row|row_id|external_id|item_id)$/i],
  },
  {
    field: 'page',
    patterns: [/^(page|page_name|account|profile|page_id)$/i],
  },
  {
    field: 'plannedSlot',
    patterns: [/^(planned\s*date|planned\s*slot|slot|post\s*time|scheduled\s*date|schedule_time|date|time)$/i],
  },
  {
    field: 'category',
    patterns: [/^(category|niche|topic|type|pillar)$/i],
  },
  {
    field: 'contentIdea',
    patterns: [/^(content\s*idea|idea|story|story\s*idea|topic\s*idea|headline\s*seed|title|concept|summary)$/i],
  },
  {
    field: 'imageIdea',
    patterns: [/^(image\s*idea|visual\s*idea|scene\s*description|visual\s*concept|scene)$/i],
  },
  {
    field: 'imagePrompt',
    patterns: [/^(image\s*prompt|midjourney\s*prompt|ai\s*image\s*prompt|prompt)$/i],
  },
  {
    field: 'imageFileName',
    patterns: [/^(image\s*file\s*name|image\s*filename|image\s*file|filename|file\s*name|image|file|image_name|photo)$/i],
  },
  {
    field: 'teaserSeed',
    patterns: [/^(teaser\s*seed|teaser|hook|first\s*line|opening\s*hook|headline)$/i],
  },
  {
    field: 'hiddenClue',
    patterns: [/^(hidden\s*clue|clue|twist|moral|ending\s*twist|revelation)$/i],
  },
  {
    field: 'keyFacts',
    patterns: [/^(key\s*facts|facts|ground\s*truth|bullet\s*points|points|verified\s*facts)$/i],
  },
  {
    field: 'sourceLinks',
    patterns: [/^(source\s*links|sources|urls|links|citations|references)$/i],
  },
];

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function matchHeader(header: string): keyof ParsedSheetRow | 'custom' {
  const norm = normalizeHeader(header);
  for (const rule of COLUMN_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(norm) || pattern.test(header.trim())) {
        return rule.field as keyof ParsedSheetRow;
      }
    }
  }
  return 'custom';
}

function splitList(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((x) => String(x).trim()).filter(Boolean);
  const str = String(val).trim();
  if (!str) return [];
  // Split on newlines, bullet points, semicolons, or numbered lists
  return str
    .split(/[\r\n;•\u2022\u25E6\u25AA\u25CF]+/)
    .map((s) => s.replace(/^[-*0-9.)\s]+/, '').trim())
    .filter((s) => s.length > 0);
}

function parseSlotDate(val: unknown): string | undefined {
  if (!val) return undefined;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString();
  }
  const str = String(val).trim();
  if (!str) return undefined;

  // Try direct Date.parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Handle common DD/MM/YYYY or MM/DD/YYYY or YYYY-MM-DD HH:mm
  const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    const d = new Date(
      Date.UTC(
        parseInt(m[1], 10),
        parseInt(m[2], 10) - 1,
        parseInt(m[3], 10),
        m[4] ? parseInt(m[4], 10) : 0,
        m[5] ? parseInt(m[5], 10) : 0,
        m[6] ? parseInt(m[6], 10) : 0
      )
    );
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

export function parseSheetBuffer(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  filename?: string
): SheetParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellText: false,
  });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return {
      totalRows: 0,
      validRows: [],
      headerMapping: {},
      warnings: ['Workbook contains no sheets.'],
      errors: ['No sheets found in workbook.'],
      previewRows: [],
    };
  }

  // Select target sheet: prioritize "Content", or first non-instruction sheet
  const skipNames = ['how to fill', 'instructions', 'readme', 'help', 'template info'];
  let sheetName = workbook.SheetNames[0];

  const contentSheet = workbook.SheetNames.find((s) =>
    s.trim().toLowerCase().includes('content')
  );
  if (contentSheet) {
    sheetName = contentSheet;
  } else {
    for (const name of workbook.SheetNames) {
      if (!skipNames.includes(name.trim().toLowerCase())) {
        sheetName = name;
        break;
      }
    }
  }

  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    return {
      totalRows: 0,
      validRows: [],
      headerMapping: {},
      warnings: [`Sheet "${sheetName}" is empty.`],
      errors: [`Could not load sheet "${sheetName}".`],
      previewRows: [],
    };
  }

  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(worksheet, {
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd hh:mm:ss',
  });

  if (rawRows.length === 0) {
    return {
      totalRows: 0,
      validRows: [],
      headerMapping: {},
      warnings: [`Sheet "${sheetName}" has no data rows.`],
      errors: [],
      previewRows: [],
    };
  }

  // Detect header mappings from keys of first row
  const rawHeaders = Object.keys(rawRows[0] || {});
  const headerMapping: Record<string, string> = {};

  for (const h of rawHeaders) {
    const matched = matchHeader(h);
    headerMapping[h] = matched;
  }

  // Verify at least contentIdea is mapped
  const mappedFields = Object.values(headerMapping);
  if (!mappedFields.includes('contentIdea')) {
    // If no explicit content idea header matched, fallback to first long string column or idea
    const fallbackHeader = rawHeaders.find((h) => /idea|content|title|text|desc/i.test(h)) || rawHeaders[0];
    if (fallbackHeader) {
      headerMapping[fallbackHeader] = 'contentIdea';
      warnings.push(`Auto-assigned column "${fallbackHeader}" as Content Idea.`);
    }
  }

  const validRows: ParsedSheetRow[] = [];

  rawRows.forEach((row, idx) => {
    const rowIndex = idx + 1;
    let externalId: string | undefined;
    let page: string | undefined;
    let plannedSlot: string | undefined;
    let category: string | undefined;
    let contentIdea = '';
    let imageIdea: string | undefined;
    let imagePrompt: string | undefined;
    let imageFileName: string | undefined;
    let teaserSeed: string | undefined;
    let hiddenClue: string | undefined;
    let keyFacts: string[] = [];
    let sourceLinks: string[] = [];
    const customFields: Record<string, unknown> = {};

    for (const [colHeader, val] of Object.entries(row)) {
      const field = headerMapping[colHeader];
      const strVal = val != null ? String(val).trim() : '';

      switch (field) {
        case 'externalId':
          if (strVal) externalId = strVal;
          break;
        case 'page':
          if (strVal) page = strVal;
          break;
        case 'plannedSlot':
          if (strVal) {
            const parsed = parseSlotDate(val);
            if (parsed) plannedSlot = parsed;
            else warnings.push(`Row ${rowIndex}: Could not parse slot date "${strVal}".`);
          }
          break;
        case 'category':
          if (strVal) category = strVal;
          break;
        case 'contentIdea':
          if (strVal) contentIdea = strVal;
          break;
        case 'imageIdea':
          if (strVal) imageIdea = strVal;
          break;
        case 'imagePrompt':
          if (strVal) imagePrompt = strVal;
          break;
        case 'imageFileName':
          if (strVal) imageFileName = strVal;
          break;
        case 'teaserSeed':
          if (strVal) teaserSeed = strVal;
          break;
        case 'hiddenClue':
          if (strVal) hiddenClue = strVal;
          break;
        case 'keyFacts':
          keyFacts = splitList(val);
          break;
        case 'sourceLinks':
          sourceLinks = splitList(val);
          break;
        default:
          if (strVal) {
            customFields[colHeader] = val;
          }
          break;
      }
    }

    if (!contentIdea) {
      warnings.push(`Row ${rowIndex}: Skipped because Content Idea is empty.`);
      return;
    }

    validRows.push({
      rowIndex,
      externalId: externalId || `ROW-${rowIndex}`,
      page,
      plannedSlot,
      category,
      contentIdea,
      imageIdea,
      imagePrompt,
      imageFileName,
      teaserSeed,
      hiddenClue,
      keyFacts,
      sourceLinks,
      customFields,
    });
  });

  return {
    totalRows: rawRows.length,
    validRows,
    headerMapping,
    warnings,
    errors,
    previewRows: validRows.slice(0, 20),
  };
}
