import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('excel_import',pathlib.Path(__file__).parents[1]/'scripts/prepare-excel-import.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def row(identifier,po='4900000001',line='00010',so='0010000001',qty=20):
    return {'id':identifier,'poCandidates':[po],'soCandidates':[so] if so else [],'line':line,'fields':{'material':'PART-A','qty':qty}}

class ImportMatchingTest(unittest.TestCase):
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
