"""extract.py 的單元測試。執行：python3 -m unittest discover -s tools -v"""
import unittest
import extract


class TestCleanVerse(unittest.TestCase):
    def test_移除標籤與開頭節號(self):
        raw = '<span id="T_Eph5v22" class="verse">22</span> 你們作妻子的、當順服自己的丈夫、如同順服主．'
        self.assertEqual(extract.clean_verse(raw), '你們作妻子的、當順服自己的丈夫、如同順服主．')

    def test_還原_html_實體(self):
        self.assertEqual(extract.clean_verse('<span>1</span> 神說&#12289;要有光'), '神說、要有光')


class TestVerseRegex(unittest.TestCase):
    def test_抓得到紅字經文(self):
        """回歸測試：耶穌的話帶 class="wj"，正則少了 [^>]* 會漏掉 114 節。"""
        page = '<p id="Matt19v24" class="wj"><span class="verse">24</span> 駱駝穿過鍼的眼。</p>'
        found = extract.VERSE_RE.findall(page)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], 'Matt')
        self.assertEqual((found[0][1], found[0][2]), ('19', '24'))

    def test_書卷代號含數字時仍正確切分(self):
        page = '<p id="1Cor7v9"><span class="verse">9</span> 倒不如嫁娶為妙。</p>'
        book, chap, verse, _ = extract.VERSE_RE.findall(page)[0]
        self.assertEqual((book, chap, verse), ('1Cor', '7', '9'))


class TestBookName(unittest.TestCase):
    def test_詩篇分卷正規化為詩篇(self):
        self.assertEqual(extract.book_name('<title>詩篇卷五（和合本）</title>'), '詩篇')

    def test_去除_bom(self):
        self.assertEqual(extract.book_name('<title>﻿約翰三書（和合本）</title>'), '約翰三書')

    def test_索引頁沒有書名(self):
        self.assertIsNone(extract.book_name('<title>舊約</title>'))


class TestKeepVerse(unittest.TestCase):
    def test_保留箴言語氣的句子(self):
        self.assertTrue(extract.keep_verse('喜樂的心、乃是良藥．憂傷的靈、使骨枯乾。'))

    def test_太短的不要(self):
        self.assertFalse(extract.keep_verse('要常常喜樂．'))

    def test_敘事句不要(self):
        self.assertFalse(extract.keep_verse('他們從約但河中取來的那十二塊石頭、約書亞就立在吉甲、你要記念。'))

    def test_沒有勸誡語氣的不要(self):
        self.assertFalse(extract.keep_verse('亞撒與他列祖同睡、葬在大衛城他列祖的墳地裡。'))


if __name__ == '__main__':
    unittest.main()
