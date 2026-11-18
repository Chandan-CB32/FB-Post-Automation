export type ContentSourceMode = 'full_ai' | 'excel_library' | 'hybrid';

export type LibrarySourceType = 'excel' | 'csv' | 'sheets';

export type LibraryMatchMethod =
  | 'exact'
  | 'ignore_ext'
  | 'normalized'
  | 'manual'
  | 'vision'
  | 'order';

export type LibraryItemStatus =
  | 'pending'
  | 'matched'
  | 'drafted'
  | 'qa_passed'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'needs_review'
  | 'skipped';

export type LibraryAssetStatus =
  | 'unmatched'
  | 'matched'
  | 'used'
  | 'image_deleted'
  | 'archived';

export interface ContentLibrary {
  id: string;
  page_id: string;
  name: string;
  source_type: LibrarySourceType;
  original_filename?: string | null;
  total_rows: number;
  imported_rows: number;
  matched_rows: number;
  published_rows: number;
  exhausted: boolean;
  created_at: string;
  updated_at: string;
}

export interface LibraryItem {
  id: string;
  library_id: string;
  page_id: string;
  row_index: number;
  external_id?: string | null;
  planned_slot?: string | null;
  category?: string | null;
  content_idea: string;
  image_idea?: string | null;
  image_prompt?: string | null;
  image_filename_hint?: string | null;
  teaser_seed?: string | null;
  hidden_clue?: string | null;
  key_facts: string[];
  source_links: string[];
  custom_fields: Record<string, unknown>;
  matched_asset_id?: string | null;
  match_method?: LibraryMatchMethod | null;
  match_confidence?: number | null;
  status: LibraryItemStatus;
  post_id?: string | null;
  vision_verification?: VisionVerificationResult | Record<string, unknown>;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LibraryAsset {
  id: string;
  page_id: string;
  library_id?: string | null;
  filename: string;
  storage_path: string;
  sha256: string;
  mime_type: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  aspect_ratio?: '4:5' | '1:1' | '16:9' | 'other' | null;
  status: LibraryAssetStatus;
  matched_item_id?: string | null;
  caption_hint?: string | null;
  vision_labels: string[];
  uploaded_at: string;
  deleted_at?: string | null;
}

export interface SheetParseResult {
  totalRows: number;
  validRows: ParsedSheetRow[];
  headerMapping: Record<string, string>;
  warnings: string[];
  errors: string[];
  previewRows: ParsedSheetRow[];
}

export interface ParsedSheetRow {
  rowIndex: number;
  externalId?: string;
  page?: string;
  plannedSlot?: string;
  category?: string;
  contentIdea: string;
  imageIdea?: string;
  imagePrompt?: string;
  imageFileName?: string;
  teaserSeed?: string;
  hiddenClue?: string;
  keyFacts: string[];
  sourceLinks: string[];
  customFields: Record<string, unknown>;
}

export interface VisionVerificationResult {
  passed: boolean;
  needsReview: boolean;
  score: number;
  detectedLabels: string[];
  contradictionDetected: boolean;
  reasoning: string;
}

export interface MatchDecision {
  itemId: string;
  assetId: string;
  method: LibraryMatchMethod;
  confidence: number;
}
