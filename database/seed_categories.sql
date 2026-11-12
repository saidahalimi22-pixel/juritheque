-- ============================================================
-- Jurithèque - Seed Data (Categories)
-- ============================================================

-- تصنيفات القوانين
INSERT INTO categories (name_ar, name_fr, slug, type, sort_order) VALUES
('القانون المدني', 'Droit civil', 'droit-civil', 'law', 1),
('قانون الإجراءات المدنية والإدارية', 'Procédure civile et administrative', 'procedure-civile', 'law', 2),
('القانون الجنائي', 'Droit pénal', 'droit-penal', 'law', 3),
('قانون الإجراءات الجزائية', 'Procédure pénale', 'procedure-penale', 'law', 4),
('قانون العمل', 'Droit du travail', 'droit-travail', 'law', 5),
('القانون التجاري', 'Droit commercial', 'droit-commercial', 'law', 6),
('القانون الإداري', 'Droit administratif', 'droit-administratif', 'law', 7),
('قانون الأسرة', 'Droit de la famille', 'droit-famille', 'law', 8),
('القانون الدستوري', 'Droit constitutionnel', 'droit-constitutionnel', 'law', 9),
('قانون الضرائب', 'Droit fiscal', 'droit-fiscal', 'law', 10);

-- تصنيفات الاجتهادات
INSERT INTO categories (name_ar, name_fr, slug, type, sort_order) VALUES
('الغرفة المدنية', 'Chambre civile', 'chambre-civile', 'jurisprudence', 1),
('الغرفة الجنائية', 'Chambre criminelle', 'chambre-criminelle', 'jurisprudence', 2),
('الغرفة الاجتماعية', 'Chambre sociale', 'chambre-sociale', 'jurisprudence', 3),
('الغرفة التجارية والبحرية', 'Chambre commerciale', 'chambre-commerciale', 'jurisprudence', 4),
('الغرفة العقارية', 'Chambre foncière', 'chambre-fonciere', 'jurisprudence', 5),
('مجلس الدولة', 'Conseil d''État', 'conseil-etat', 'jurisprudence', 6);

-- تصنيفات عامة للكتب والمقالات والرسائل
INSERT INTO categories (name_ar, name_fr, slug, type, sort_order) VALUES
('القانون الخاص', 'Droit privé', 'droit-prive', 'general', 1),
('القانون العام', 'Droit public', 'droit-public', 'general', 2),
('القانون الجنائي والعلوم الجنائية', 'Droit pénal et sciences criminelles', 'sciences-criminelles', 'general', 3),
('القانون الدولي', 'Droit international', 'droit-international', 'general', 4),
('حقوق الإنسان', 'Droits de l''homme', 'droits-homme', 'general', 5),
('القانون والاقتصاد', 'Droit et économie', 'droit-economie', 'general', 6),
('القانون والتكنولوجيا', 'Droit et technologie', 'droit-technologie', 'general', 7);
