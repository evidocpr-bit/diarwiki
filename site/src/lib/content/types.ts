export type PublicationStatus = 'draft' | 'ready' | 'published' | 'archived';
export type MedicalReviewStatus = 'pending' | 'reviewed' | 'revision_required';
export type ContentType = 'article' | 'pathway' | 'glossary' | 'page';

export interface ContentSummary {
  id: string;
  order: number | null;
  slug: string;
  href: string;
  title: string;
  summary: string;
  type: ContentType;
  status: PublicationStatus;
  medicalReview: MedicalReviewStatus;
  reviewedBy: string | null;
  reviewerSpecialty: string | null;
  reviewedAt: Date | null;
  audience: string[];
  topics: string[];
  updatedAt: Date;
  sourceIds: string[];
  relatedIds: string[];
}

export interface ContentRepository {
  listPublished(type?: ContentType): Promise<ContentSummary[]>;
  findBySlug(slug: string): Promise<ContentSummary | undefined>;
  findById(id: string): Promise<ContentSummary | undefined>;
  relatedTo(id: string): Promise<ContentSummary[]>;
}
