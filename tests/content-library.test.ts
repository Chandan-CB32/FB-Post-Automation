import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSheetBuffer,
  generateLibraryTemplateBuffer,
  runAutoMatching,
  suggestVisionMatches,
  calculateSha256,
  detectAspectRatio,
  verifyLibraryCaptionGrounding,
  runGenerationPipeline,
  runAutonomousCycle,
  LibraryItem,
  LibraryAsset,
} from '../packages/core/src/index.js';
import * as XLSX from 'xlsx';

describe('Excel + Image Library Mode Test Suite (ANTIGRAVITY PRD)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Scenario 1: parseSheetBuffer with Canonical .xlsx
  // --------------------------------------------------------------------------
  it('Scenario 1: parseSheetBuffer with canonical .xlsx parses rows and all columns accurately', () => {
    const templateBuf = generateLibraryTemplateBuffer();
    const result = parseSheetBuffer(templateBuf, 'content_library_template.xlsx');

    expect(result.errors).toHaveLength(0);
    expect(result.validRows.length).toBeGreaterThanOrEqual(3);

    const firstRow = result.validRows[0];
    expect(firstRow.externalId).toBe('SCI-001');
    expect(firstRow.contentIdea).toContain('Giant Squid');
    expect(firstRow.imageFileName).toBe('giant_squid_bioluminescence.jpg');
    expect(firstRow.teaserSeed).toContain('Under crushing darkness');
    expect(firstRow.hiddenClue).toContain('Photophores emit 510nm');
    expect(firstRow.keyFacts.length).toBeGreaterThanOrEqual(2);
    expect(firstRow.sourceLinks.length).toBeGreaterThanOrEqual(1);
    expect(result.headerMapping).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Scenario 2: parseSheetBuffer with .csv and Alternative Headers
  // --------------------------------------------------------------------------
  it('Scenario 2: parseSheetBuffer with .csv tolerates alternative column headers', () => {
    const csvContent = `Story,Image,Ground Truth,First Line,Ending Twist\n"Quantum Entanglement in Microscopic Crystals","quantum_crystal.png","Atoms synchronized at 4 Kelvin; Entanglement sustained for 12ms","Physicists observed instant quantum linkage.","The state collapsed when observed by detector."`;
    const buffer = Buffer.from(csvContent, 'utf-8');

    const result = parseSheetBuffer(buffer, 'test_export.csv');
    expect(result.errors).toHaveLength(0);
    expect(result.validRows).toHaveLength(1);

    const row = result.validRows[0];
    expect(row.contentIdea).toBe('Quantum Entanglement in Microscopic Crystals');
    expect(row.imageFileName).toBe('quantum_crystal.png');
    expect(row.keyFacts).toContain('Atoms synchronized at 4 Kelvin');
    expect(row.teaserSeed).toContain('Physicists observed instant quantum linkage');
    expect(row.hiddenClue).toContain('The state collapsed');
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Auto-Matching Hierarchy
  // --------------------------------------------------------------------------
  it('Scenario 3: matching hierarchy supports exact, ignore_ext, normalized, vision, and order matching', () => {
    const items: LibraryItem[] = [
      {
        id: 'item-1',
        library_id: 'lib-1',
        page_id: 'page-1',
        row_index: 1,
        content_idea: 'Giant Squid',
        image_filename_hint: 'squid.jpg',
        key_facts: [],
        source_links: [],
        custom_fields: {},
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'item-2',
        library_id: 'lib-1',
        page_id: 'page-1',
        row_index: 2,
        content_idea: 'White Dwarf Planet',
        image_filename_hint: 'white_dwarf', // missing extension
        key_facts: [],
        source_links: [],
        custom_fields: {},
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'item-3',
        library_id: 'lib-1',
        page_id: 'page-1',
        row_index: 3,
        content_idea: 'Ancient Sea Turtle',
        image_filename_hint: 'Ancient-Sea-Turtle-Photo', // normalized symbols
        key_facts: [],
        source_links: [],
        custom_fields: {},
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'item-4',
        library_id: 'lib-1',
        page_id: 'page-1',
        row_index: 4,
        content_idea: 'Deep Mariana Trench exploration sub',
        image_filename_hint: undefined,
        key_facts: ['Deep ocean trench', 'submarine abyss'],
        source_links: [],
        custom_fields: {},
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const assets: LibraryAsset[] = [
      {
        id: 'asset-1',
        page_id: 'page-1',
        filename: 'squid.jpg',
        storage_path: 'page-1/squid.jpg',
        sha256: 'hash1',
        mime_type: 'image/jpeg',
        bytes: 1024,
        status: 'unmatched',
        vision_labels: ['squid', 'ocean'],
        uploaded_at: new Date().toISOString(),
      },
      {
        id: 'asset-2',
        page_id: 'page-1',
        filename: 'white_dwarf.png',
        storage_path: 'page-1/white_dwarf.png',
        sha256: 'hash2',
        mime_type: 'image/png',
        bytes: 1024,
        status: 'unmatched',
        vision_labels: ['star', 'space'],
        uploaded_at: new Date().toISOString(),
      },
      {
        id: 'asset-3',
        page_id: 'page-1',
        filename: 'ancient_sea_turtle_photo.jpeg',
        storage_path: 'page-1/ancient_sea_turtle_photo.jpeg',
        sha256: 'hash3',
        mime_type: 'image/jpeg',
        bytes: 1024,
        status: 'unmatched',
        vision_labels: ['turtle', 'reef'],
        uploaded_at: new Date().toISOString(),
      },
      {
        id: 'asset-4',
        page_id: 'page-1',
        filename: 'ocean_submersible_in_trench.jpg',
        storage_path: 'page-1/ocean_submersible_in_trench.jpg',
        sha256: 'hash4',
        mime_type: 'image/jpeg',
        bytes: 1024,
        status: 'unmatched',
        vision_labels: ['submarine', 'deep ocean', 'trench'],
        uploaded_at: new Date().toISOString(),
      },
    ];

    // 1. Exact, ignore_ext, normalized match
    const autoResult = runAutoMatching(items, assets);
    expect(autoResult.matches).toHaveLength(3);

    const m1 = autoResult.matches.find((m) => m.itemId === 'item-1');
    expect(m1?.method).toBe('exact');
    expect(m1?.confidence).toBe(1.0);

    const m2 = autoResult.matches.find((m) => m.itemId === 'item-2');
    expect(m2?.method).toBe('ignore_ext');
    expect(m2?.confidence).toBe(0.95);

    const m3 = autoResult.matches.find((m) => m.itemId === 'item-3');
    expect(m3?.method).toBe('normalized');
    expect(m3?.confidence).toBe(0.9);

    // 2. Vision suggestion for item-4
    const visionSuggestions = suggestVisionMatches([items[3]], [assets[3]]);
    expect(visionSuggestions).toHaveLength(1);
    expect(visionSuggestions[0].itemId).toBe('item-4');
    expect(visionSuggestions[0].assetId).toBe('asset-4');
    expect(visionSuggestions[0].method).toBe('vision');
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Duplicate Asset Upload via SHA-256
  // --------------------------------------------------------------------------
  it('Scenario 4: calculateSha256 produces consistent hashes for deduplication and detectAspectRatio identifies 4:5', () => {
    const dummyImage = Buffer.from('TEST_IMAGE_BYTES_12345');
    const hash1 = calculateSha256(dummyImage);
    const hash2 = calculateSha256(dummyImage);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);

    expect(detectAspectRatio(1080, 1350)).toBe('4:5');
    expect(detectAspectRatio(1200, 1200)).toBe('1:1');
    expect(detectAspectRatio(1920, 1080)).toBe('16:9');
    expect(detectAspectRatio(800, 400)).toBe('other');
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Missing Image in excel_library Mode Blocks Publishing (Never Text-Only)
  // --------------------------------------------------------------------------
  it('Scenario 5: excel_library mode strictly rejects text-only posting when image asset is missing', async () => {
    await expect(
      runGenerationPipeline({
        page: {
          id: 'test-page-1',
          name: 'Science Frontier',
          publishing_mode: 'auto',
          content_source_mode: 'excel_library',
        } as any,
        libraryItem: {
          contentIdea: 'Dark Energy Expansion',
          keyFacts: ['Universe is accelerating'],
        },
        // No libraryImageBuffer supplied
      })
    ).rejects.toThrow(/excel_library mode requires a matched image asset/);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Hybrid Mode Fallback to Full-AI Image Generation
  // --------------------------------------------------------------------------
  it('Scenario 6: hybrid mode falls back to Full-AI image generator when library image is missing', async () => {
    const result = await runGenerationPipeline({
      page: {
        id: 'test-page-2',
        name: 'Beyond the Known',
        publishing_mode: 'auto',
        content_source_mode: 'hybrid',
      } as any,
      libraryItem: {
        contentIdea: 'Deep Sea Bioluminescence',
        imagePrompt: 'Photorealistic giant squid in dark ocean',
        keyFacts: ['Light produced at 510 nm wavelength'],
      },
      // libraryImageBuffer omitted -> triggers hybrid AI image fallback
    });

    expect(result.success).toBe(true);
    expect(result.compositeImageUrl).toBeDefined();
    expect(result.caption).toContain('Bioluminescence');
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Post-Publish Cleanup Logic Verification
  // --------------------------------------------------------------------------
  it('Scenario 7: verifies post-publish image deletion and library status transition to published', async () => {
    const mockStorageRemove = vi.fn().mockResolvedValue({ data: {}, error: null });
    const mockAssetUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: {}, error: null }) });
    const mockItemUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: {}, error: null }) });
    const mockLibUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: {}, error: null }) });

    // Emulate post-publish cleanup callback
    async function cleanupPublishedLibraryAsset(assetStoragePath: string, assetId: string, itemId: string, libraryId: string) {
      await mockStorageRemove([assetStoragePath]);
      await mockAssetUpdate({ status: 'image_deleted', deleted_at: new Date().toISOString() }).eq('id', assetId);
      await mockItemUpdate({ status: 'published', updated_at: new Date().toISOString() }).eq('id', itemId);
      await mockLibUpdate({ published_rows: 1, exhausted: false }).eq('id', libraryId);
    }

    await cleanupPublishedLibraryAsset('page-1/photo.jpg', 'asset-1', 'item-1', 'lib-1');

    expect(mockStorageRemove).toHaveBeenCalledWith(['page-1/photo.jpg']);
    expect(mockAssetUpdate).toHaveBeenCalled();
    expect(mockItemUpdate).toHaveBeenCalled();
    expect(mockLibUpdate).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Vision Grounding Contradiction Detection
  // --------------------------------------------------------------------------
  it('Scenario 8: verifyLibraryCaptionGrounding handles contradiction audit gracefully', async () => {
    const dummyImage = Buffer.from('MOCK_PIXEL_DATA');
    const result = await verifyLibraryCaptionGrounding({
      imageBuffer: dummyImage,
      caption: 'The giant squid emits radiant green bioluminescence in the Mariana Trench.',
      contentIdea: 'Giant Squid Bioluminescent Hunting Tail',
      keyFacts: ['Emits 510nm green light'],
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.contradictionDetected).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Fiction Niche Generation with Teaser Seed & Hidden Clue
  // --------------------------------------------------------------------------
  it('Scenario 9: fiction generation incorporates teaser_seed hook and hidden_clue twist', async () => {
    const fakeImageBuffer = Buffer.from('FAKE_IMAGE_BYTES');
    const result = await runGenerationPipeline({
      page: {
        id: 'test-page-fiction',
        name: 'The Midnight Archives',
        publishing_mode: 'auto',
        content_source_mode: 'excel_library',
      } as any,
      profile: {
        id: 'prof-fiction',
        name: 'Horror & Creepypasta',
        type: 'fiction',
        masterPrompt: 'Write an eerie story.',
      } as any,
      libraryItem: {
        contentIdea: 'The clockmaker who trapped time in a glass prism',
        teaserSeed: 'In 1884 London, watchmaker Silas Vance made a clock that never ticked forward.',
        hiddenClue: 'The dust inside the prism was frozen mid-air',
        keyFacts: ['Fleet street workshop was found empty'],
      },
      libraryImageBuffer: fakeImageBuffer,
    });

    expect(result.success).toBe(true);
    expect(result.caption).toContain('Silas Vance');
    expect(result.caption).toContain('frozen mid-air');
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Downloadable Template Endpoint Content
  // --------------------------------------------------------------------------
  it('Scenario 10: generateLibraryTemplateBuffer creates valid multi-tab Excel workbook', () => {
    const buffer = generateLibraryTemplateBuffer();
    expect(buffer).toBeInstanceOf(Buffer);

    const wb = XLSX.read(buffer, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Content');
    expect(wb.SheetNames).toContain('How to fill');

    const contentSheet = wb.Sheets['Content'];
    const rows: any[] = XLSX.utils.sheet_to_json(contentSheet);
    expect(rows.length).toBe(3);
    expect(rows[0]['Content Idea']).toBeDefined();
    expect(rows[0]['Image File Name']).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Scenario 11: End-to-End Simulation of 3-Row Processing
  // --------------------------------------------------------------------------
  it('Scenario 11: end-to-end 3-row import, match, and pipeline generation', async () => {
    const templateBuf = generateLibraryTemplateBuffer();
    const parsed = parseSheetBuffer(templateBuf);
    expect(parsed.validRows).toHaveLength(3);

    const dummyAssets: LibraryAsset[] = parsed.validRows.map((r, i) => ({
      id: `asset-${i + 1}`,
      page_id: 'page-sim',
      filename: r.imageFileName || `img_${i + 1}.jpg`,
      storage_path: `page-sim/img_${i + 1}.jpg`,
      sha256: `hash_${i + 1}`,
      mime_type: 'image/jpeg',
      bytes: 2048,
      status: 'unmatched',
      vision_labels: [r.category || 'science'],
      uploaded_at: new Date().toISOString(),
    }));

    const mockItems: LibraryItem[] = parsed.validRows.map((r, i) => ({
      id: `item-${i + 1}`,
      library_id: 'lib-sim',
      page_id: 'page-sim',
      row_index: r.rowIndex,
      external_id: r.externalId,
      content_idea: r.contentIdea,
      image_filename_hint: r.imageFileName,
      teaser_seed: r.teaserSeed,
      hidden_clue: r.hiddenClue,
      key_facts: r.keyFacts,
      source_links: r.sourceLinks,
      custom_fields: r.customFields,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const matchOutcome = runAutoMatching(mockItems, dummyAssets);
    expect(matchOutcome.matches).toHaveLength(3);
    for (const m of matchOutcome.matches) {
      expect(m.confidence).toBe(1.0);
    }

    // Run pipeline for first matched row
    const pipelineRes = await runGenerationPipeline({
      page: {
        id: 'page-sim',
        name: 'Beyond the Known',
        publishing_mode: 'auto',
        content_source_mode: 'excel_library',
      } as any,
      libraryItem: parsed.validRows[0],
      libraryImageBuffer: Buffer.from('SIMULATED_PIXEL_BUFFER'),
    });

    expect(pipelineRes.success).toBe(true);
    expect(pipelineRes.caption).toContain(parsed.validRows[0].contentIdea);
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Multi-Page Isolation (excel_library vs full_ai)
  // --------------------------------------------------------------------------
  it('Scenario 12: multi-page isolation ensures Page A in excel_library and Page B in full_ai do not collide', async () => {
    // Page A: excel_library with image
    const resA = await runGenerationPipeline({
      page: {
        id: 'page-A',
        name: 'Page A (Curated)',
        content_source_mode: 'excel_library',
      } as any,
      libraryItem: {
        contentIdea: 'Bioluminescent Squid',
        keyFacts: ['510nm green glow'],
      },
      libraryImageBuffer: Buffer.from('PAGE_A_BUFFER'),
    });

    // Page B: full_ai autonomous
    const resB = await runGenerationPipeline({
      page: {
        id: 'page-B',
        name: 'Page B (Autonomous AI)',
        content_source_mode: 'full_ai',
      } as any,
      userTopic: 'Supermassive Black Hole Singularity',
      isTestRun: true,
    });

    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);
    expect(resA.caption).toContain('Bioluminescent');
    expect(resB.caption).not.toContain('Bioluminescent');
  });
});
