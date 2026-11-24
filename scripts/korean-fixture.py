"""Optional fixture regeneration: python -m pip install pymupdf; python scripts/korean-fixture.py."""
import pymupdf

doc = pymupdf.open()
page = doc.new_page()
lines = [
    '가상 자료 전용 / 실제 민원자료 아님', '조경계획도 L-001',
    '대지면적: 1000 m2', '연면적: 2000 m2', '계획 조경면적: 160 m2',
    '식재면적: 80 m2', '자연지반면적: 20 m2', '옥상조경면적: 0 m2', '벽면녹화면적: 0 m2',
]
page.insert_text((50, 70), '\n\n'.join(lines), fontname='korea', fontsize=16)
doc.set_metadata({'title':'Synthetic Korean landscape schedule','author':'Forestwom'})
doc.save('public/samples/korean.pdf')
