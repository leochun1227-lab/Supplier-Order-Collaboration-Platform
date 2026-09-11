import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('excel_import',pathlib.Path(__file__).parents[1]/'scripts/prepare-excel-import.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def row(identifier,po='4900000001',line='00010',so='0010000001',qty=20):
    return {'id':identifier,'poCandidates':[po],'soCandidates':[so] if so else [],'line':line,'fields':{'material':'PART-A','qty':qty}}

class ImportMatchingTest(unittest.TestCase):
    def test_updated_dates_in_filenames_do_not_require_code_changes(self):
        root=pathlib.Path('updated-inputs')
        names=['2027 Parts order list发澳洲.xlsx','澳洲采购及售后配件发运10.1-10.8.xlsx','澳洲备品备件未完成清单截止10.8.xlsx','每周延迟发运（截止10.8）.xlsx']
        matches={pattern:[root/name] for pattern,name in zip(module.FILE_PATTERNS.values(),names)}
        with patch.object(pathlib.Path,'glob',side_effect=lambda pattern:matches[pattern]),patch.object(pathlib.Path,'is_file',return_value=True):
            self.assertEqual(len(module.discover_files(root)),4)
            matches[module.FILE_PATTERNS['delayed']].append(root/'每周延迟发运（截止10.1）.xlsx')
            with self.assertRaisesRegex(ValueError,'Expected one delayed'):module.discover_files(root)
            self.assertEqual(module.discover_files(root,{'delayed':root/names[3]})['delayed'].name,names[3])
    def test_column_reorder_or_missing_column_is_rejected_instead_of_silently_misreading(self):
        module.validate_headers(module.HEADERS,'master')
        module.validate_headers(module.HEADERS,'open')
        module.validate_headers(module.WEEKLY_HEADERS,'weekly')
        module.validate_headers(module.HEADERS[:16]+['ETA']+module.HEADERS[16:],'delayed')
        changed=module.HEADERS.copy();changed[2],changed[8]=changed[8],changed[2]
        with self.assertRaisesRegex(ValueError,'Changed or missing'):module.validate_headers(changed,'master')
        with self.assertRaisesRegex(ValueError,'Changed or missing'):module.validate_headers(module.HEADERS[:-1],'master')
    def test_annotated_reference_is_preserved_as_candidates(self):
        self.assertEqual(module.candidates('10000001 / 10000002 (split)','so'),['0010000001','0010000002'])
        self.assertEqual(module.candidates('4900000001（澳洲取消）','po'),['4900000001'])
        self.assertEqual(module.candidates('TBD','so'),[])
    def test_missing_line_can_match_unique_evidence_but_not_first_of_duplicates(self):
        extra=row('weekly',line=None);masters=[row('master-1')]
        self.assertEqual(len(module.match_rows(extra,masters)),1)
        masters.append(row('master-2',line='00020'))
        self.assertEqual(len(module.match_rows(extra,masters)),2)
    def test_explicit_different_line_or_quantity_is_not_silently_joined(self):
        self.assertEqual(module.match_rows(row('extra',line='00020'),[row('master')]),[])
        self.assertEqual(module.match_rows(row('extra',qty=10),[row('master')]),[])
    def test_empty_placeholders_equal_but_unknown_date_stays_unknown(self):
        self.assertEqual(module.text('/'),module.text(None));self.assertEqual(module.text('TBD'),'TBD')

if __name__=='__main__':unittest.main()
