export interface CmsMedicalReview {
  fingerprint: string;
  reviewer_name: string;
  reviewer_specialty: string;
  reviewer_profile_url?: string;
  decision: 'approved';
  reviewed_at: string;
}

export interface CmsMaterialSnapshot {
  content_id: string;
  slug: string;
  content_type: 'article' | 'pathway' | 'glossary' | 'page';
  title: string;
  description: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  blocks: Array<{ id: string; sort_order: number; block_type: string; item: Record<string, unknown> }>;
  sources: Array<{ source_id: string; title: string; url: string }>;
  related: Array<{ content_id: string; slug: string; title: string }>;
  medical_review: CmsMedicalReview | null;
}

export interface CmsReleaseSnapshot {
  schema_version: 1;
  snapshot_id: string;
  snapshot_sha256: string;
  source_commit: string;
  content: {
    materials: CmsMaterialSnapshot[];
    sources: Array<Record<string, unknown>>;
    library_items: Array<Record<string, unknown>>;
    pages: Array<Record<string, unknown>>;
    navigation: Array<Record<string, unknown>>;
    site_settings: Record<string, unknown>;
    media_manifest: Array<Record<string, unknown>>;
    redirects: Array<Record<string, unknown>>;
  };
}
