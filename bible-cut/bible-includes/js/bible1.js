var cssfolder = '';
var cssfile = '';
var min_textColor = 1;
var max_textColor = 3;
var curr_textColor = 2;
var min_fontsize = -11;
var max_fontsize = 14;
var curr_fontsize = 0;
var curr_verseStyle = 0;
var search_res = '';
const bVersion = [];
bVersion['K'] = 'KJV';
bVersion['L'] = 'LXX';
bVersion['W'] = 'WEB';
bVersion['T'] = 'CUT';
bVersion['S'] = 'CUS';

document.addEventListener('DOMContentLoaded', function(event) {
	// add onload function calls here
		
	// Change to line mode except for Chinese pages and Psalms
	var eBody = document.getElementsByTagName('BODY');
	if (eBody[0].classList.contains('chinPage')) return;
	if (eBody[0].classList.contains('verseStylePsalm')) return;
	chg_verseStyle();	// how each verse on a new line
})

// function color_changer
//   change text color
function chg_textColor(i) {
	if (i >= min_textColor && i <= max_textColor) {
		if (i != curr_textColor) {
		var elem = document.getElementsByTagName('BODY');
		for (var j=min_textColor; j<=max_textColor; j++) {
			elem[0].classList.remove('textColor' + j);
		}
		elem[0].classList.add('textColor' + i);
		curr_textColor = i;
		}
	}
}

// function chg_fontsize 
//   change font size
function chg_fontsize(i) {	
	if (i == 1) {
		if (curr_fontsize < max_fontsize) curr_fontsize++;
	}
	else if (i == 0) curr_fontsize = 0;	
	else if (curr_fontsize > min_fontsize) curr_fontsize--;

	var elem = document.getElementsByTagName('BODY');
	for (var j=min_fontsize; j<=max_fontsize; j++) {
		elem[0].classList.remove('fontsize' + j);
	}
	elem[0].classList.add('fontsize' + curr_fontsize);
}

// function chg_verseStyle
//	- start verse style
//	0: default; 1:show each verse on a new line
function chg_verseStyle() {
	var elem = document.getElementsByTagName('BODY');
	
	var img = document.getElementById('p_or_list');
	if (typeof(img) != 'undefined' && img != null) {
		if (curr_verseStyle == 1) {
			elem[0].classList.remove("verseStyle1");
			img.src = img.src.replace("list.png","paragraph.png");
			curr_verseStyle = 0;
		}
		else {		
			elem[0].classList.add("verseStyle1");
			img.src = img.src.replace("paragraph.png","list.png");
			curr_verseStyle = 1;
		}
	}
}

// function gotoVerse
//   for Bible pages - jump to Bible verse
function gotoVerse(verse_prefix) {
	if (search_res != '') {
		var prev_elem = document.getElementById(search_res);
		prev_elem.className = prev_elem.className.replace(/\b search-hilite\b/g, "");
		search_res = '';
	}
	document.getElementById('searchMsg').innerHTML = '';
	var chap = document.getElementById("findChap").value;
	var verse = document.getElementById("findVerse").value;
	var elem_id = verse_prefix + chap + 'v' + verse;
	if (verse == '1') elem_id = 'chap_' + chap;
	var elem = document.getElementById(elem_id);
	if (elem != 'undefined' && elem != null) {
		if (verse != '1') {
			document.getElementById('searchMsg').innerHTML = '';
			search_res = elem_id;
			elem.className += " search-hilite";
		}
		location.href = '#' + elem_id;
	}
	else {
		document.getElementById('searchMsg').innerHTML = 'Error - Verse not found!'
	}
}

function gotoCorrPsalm(toVersion, fromVersion) {
	var verseID = getFirstVisible();
	var currChapVerse = getChapVerse(verseID);	// [0]=chapter, [1]=verse (v456)
	var psalmNum = Number(currChapVerse[0]);
	var verse = currChapVerse[1];
	var verseNum = Number(verse.substr(1,verse.length));
	var psalmBook = 1;
	var hashtag = '';
	
	// no verses visible, e.g. at footnote section
	// go to corresponding file
	if (verseID == '') {
		var filepath = location.href.replace(location.hash,'');
		filepath = filepath.substring(filepath.lastIndexOf('/')+1);
		filepath = filepath.replace(bVersion[fromVersion] + '_', bVersion[toVersion] + '_');
		location.href = '../' + bVersion[toVersion] + '/' + filepath;
		return;
	}
	else {	
		// get Psalm book number
		if (toVersion == 'L') {
			if (psalmNum == 10) {
				psalmNum = 9;
				verseNum = verseNum + 20;
			}
			else if (psalmNum == 147) {
				if (verseNum <= 11) psalmNum = 146;
				else verseNum = verseNum - 11;
			}
			else if (psalmNum >=11 && psalmNum <= 146)
				psalmNum = psalmNum - 1;
			
			if (psalmNum >= 41) psalmBook = 2;
			if (psalmNum >= 72) psalmBook = 3;
			if (psalmNum >= 89) psalmBook = 4;
			if (psalmNum >= 106) psalmBook = 5;
		}
		else if (fromVersion == 'L') {
			
			if (psalmNum == 9 && verseNum + 20) 
				psalmNum = 10
			else if (psalmNum == 146) 
				psalmNum = 147;
			else if (psalmNum == 147)
				verseNum = verseNum + 11;
			else if (psalmNum >=10 && psalmNum <= 145)
				psalmNum = psalmNum + 1;
			
			if (psalmNum >= 42) psalmBook = 2;
			if (psalmNum >= 73) psalmBook = 3;
			if (psalmNum >= 90) psalmBook = 4;
			if (psalmNum >= 107) psalmBook = 5;
		}
	
		var gotoURL = '../' + bVersion[toVersion] + '/' + bVersion[toVersion] + '_Psalms-Book' + psalmBook + '.html';
		
		var topSection = document.getElementById('goto-verse');
		if (typeof(topSection) != 'undefined' && topSection != null) {
			var isTopVisible = isElemVisible(topSection);
			
			// section before book content not visible		
			if (!isTopVisible) {
				if (verseNum == 1) 
					verseID = 'chap_' + psalmNum;
				else
					verseID = toVersion + '_Ps' + psalmNum + 'v' + verseNum;
			}
			gotoURL = gotoURL + '#' + verseID;
		}
		location.href = gotoURL;
	}
}

function gotoCorrPsalmsIndex(toVersion, fromVersion) {
	var array_index = document.getElementsByClassName('index');
	var elem = null;
	var psalmNum = 1;
	var last_index_id = '';
	var hashtag = '';
	
	for (let i=0; i<array_index.length; i++) {
		elem = array_index[i];
		last_index_id = elem.id;
		if (isElemVisible(elem)) {
			break;
		}
	}

	if (last_index_id == '') {	// no elements with class index are visible
		hashtag = '';
	}
	else if (elem.id.indexOf('-') > 0) {	// first visible was an index range, e.g. 10-19
		hashtag = '#' + last_index_id;
	}
	else {	// index is a chapter number
		psalmNum = Number(last_index_id);
		
		// convert if going to/from LXX
		if (toVersion == 'L') {
			if (psalmNum >= 10 && psalmNum <= 146) {
				psalmNum = psalmNum - 1;
			}
			else if (psalmNum == 147) {
				psalmNum = 146;
			}
		}
		else if (fromVersion == 'L') {
			if (psalmNum >= 10 && psalmNum <= 145) {
				psalmNum = psalmNum + 1;
			}
			else if (psalmNum == 146) {
				psalmNum = 147;
			}
		}
		hashtag = '#' + psalmNum;
	}
	location.href = '../' + bVersion[toVersion] + '/' + bVersion[toVersion] + '_index_Psalms.html' + hashtag;
}	

// goto corresponding chapter/verse in other versions
//	toVersion - e.g. W for WEB
//	fromVersion - e.g. C for CUT
//	apFile -
//		'' - not AP
//		Y - is AP
//		(filename) - AP filename
//	apBookPrefix - AP book prefix
//	hasCorrNum -
//		Y - chapter and verse numbers stay the same
//		V - only verse number stays the same
//		N - not the same
function gotoCorr(toVersion, fromVersion, apFile, apBookPrefix, hasCorrNum) {
	// find first visible verse on screen
	var verseID = getFirstVisible();

	// split verseID into array
	// [0]=chapter, [1]=verse (v456)
	var currChapVerse = getChapVerse(verseID);	
	
	var filepath = location.href.replace(location.hash,'');
	var tmpPos = 0;

	// replace version e.g. WEB -> KJV
	filepath = filepath.replaceAll(bVersion[fromVersion], bVersion[toVersion]);
		
	// replace full path with relative (eg. KJV/KJV_John.html)
	tmpPos = filepath.indexOf('/'+bVersion[toVersion]+'/');
	filepath = filepath.substr(tmpPos+1, filepath.length);
	
	// if AP file has a different filename
	if (apFile != '' && apFile != 'A') {	// replace filename
		tmpPos = filepath.lastIndexOf('/');
		var filename = filepath.substr(tmpPos+1, filepath.length);		
		filepath = filepath.replace(filename, apFile);		
		if (apFile.indexOf('.html') < 0)
			filepath = filepath + '.html';
	}
		
	if (apFile != '') filepath = '../../' + filepath;	// AP
	else filepath = '../' + filepath;
	
	var topSection = document.getElementById('goto-verse');
	if (typeof(topSection) != 'undefined' && topSection != null) {		
		var isTopVisible = isElemVisible(topSection);
		
		// section before book content not visible		
		if (!isTopVisible) {
	
			// add hashtag, e.g. #K_John3v3, #chap_21
			if (hasCorrNum == 'Y') { // destination has same chapter/verse numbering
			
				// verse 1 - goto chapter head
				if (currChapVerse[1] == 'v1') {
					if (filepath.indexOf('v1') < filepath.length-1) {
						filepath = filepath + '#chap_' + currChapVerse[0];
					}
				}			
				// has a different book prefix, eg. aaa2v3 -> bbb2v3
				else if (apBookPrefix != '') {
					filepath = filepath + '#' + toVersion + '_' + apBookPrefix + currChapVerse[0] + currChapVerse[1];
				}
				else filepath = filepath + '#' + toVersion + '_' + verseID;
			}
			else if (hasCorrNum == 'V') {	// only verse number stay the same
				filepath = filepath + currChapVerse[1]; 
			}
		}
	}
	location.href = filepath;
}

function gotoCorrAzarias(toVersion, fromVersion) {
	var verseID = getFirstVisible();
	var currChapVerse = getChapVerse(verseID);	// [0]=chapter, [1]=verse (v456)
	var chapNum = currChapVerse[0];
	var verse = currChapVerse[1];
	var verseNum = Number(verse.substr(1,verse.length));
	var filepath = '';
	var azarias = [
	'../../KJV/KJV-AP/KJV_Prayer-of-Azarias.html',
	'../../WEB/WEB-AP/WEB_Daniel-Greek.html',
	'../../LXX/LXX-AP/LXX_Prayer-of-Azarias.html'
	];
	
	// K to W
	if (fromVersion == 'K' && toVersion == 'W') {
		location.href = azarias[1] + '#W_h_SongOfThree';
		return;
	}
	
	// K to L
	if (fromVersion == 'K' && toVersion == 'L') {
		if (verseNum == 1) 
			filepath = azarias[2];
		else {
			verseNum = verseNum - 1;
			filepath = azarias[2] + '#L_PrAz1v' + verseNum;
		}
		location.href = filepath;
		return;
	}

	// L to K
	if (fromVersion == 'L' && toVersion == 'K') {
		if (verseNum > 1) {
			verseNum = verseNum + 1;
			filepath = azarias[0] + '#K_PrAz' + chapNum + 'v' + verseNum;
		}
		else {
			filepath = azarias[0] + '#chap_1';
		}
		location.href = filepath;
		return;
	}

	// L to W
	if (fromVersion == 'L' && toVersion == 'W') {
		location.href = azarias[1] + '#W_h_SongOfThree';
	}	
}

// for 'abc123v456', return [0]='123 [1]='v456' 
// for 'abc123v1', return [0]='chap_123' [1]=''
function getChapVerse(verseID) {
	var tmp = '';
	var retval = [];
	retval[0] = '';		// chapter
	retval[1] = '';		// verse
	var oneChar;
	var chapter = '';
	var verse = '';
	var tmpPos = verseID.lastIndexOf('v');
	for (var i=tmpPos-1; i>0; i--) {
		oneChar = verseID.charAt(i);
		if (oneChar < '0' || oneChar > '9') break;			
	}
	retval[0] = verseID.substring(i+1, tmpPos);
	retval[1] = verseID.substr(tmpPos,verseID.length);

	return retval;
}

//	function getFirstVisible 
//	- return first visible chapter and verse eg. Num6v24
//	- return '' if no verses visible, e.g. in footnote section
function getFirstVisible() {
	var array_verses = document.getElementsByClassName('verse');
	var total_verses = array_verses.length-1;
	var elem = null;	
	var verseID = '';	
	for (let i=0; i<array_verses.length; i++) {
		elem = array_verses[i];
		if (isElemVisible(elem)) {
			verseID = elem.id;
			verseID = verseID.substr(verseID.indexOf('_')+1,verseID.length);	// eg. 1Chron3v4 from K_1Chron3v4
			break;
		}
	}
	return verseID;
}

function isElemVisible(el) {
	if (typeof(el) == 'undefined' || el == null) {
		return false;
	}
	else {
		var rect = el.getBoundingClientRect();
		return (
			rect.top >= -.4 && rect.left >= 0 && 
			rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
			rect.right <= (window.innerWidth || document.documentElement.clientWidth))
	}
}

// function gotoFN
// - go to footnote, i.e. open collapsible with id = 'collapsible_' + dest_id
//	and then go to the div or p with id = dest_id,
//
// 	or if dest_id has no value or no vald value,
//		open collapsible with id = hash from url
//		(it will automatically go to the div or p with id = hash from url, so no need to do it here)
function gotoFN() {
	var cb = document.getElementById('collapsible-footnotes');	// checkbox for the collapsible
	if (cb) {				// if collapsible checkbox ID exists
		cb.checked = true;	// open collapsible
		window.location.hash = dest_id;	// go to location on page
	}
}

// val_ID
// - validate if an identifier is valid:
//		only allow letters, digits, space, dash and underscore
// - return true if valid; else false
function val_ID(id) {
	if (typeof id === 'string') {
		var RegEx = /^[a-z0-9 _-]+$/i;	// case-insensitive
		var valid = RegEx.test(id);
		if (valid) return true;
		else return false;
	}
	else return false;
}

// close_collapse
// - uncheck checkbox associated with a collapse container
function close_collapse(el) {
	var collapsible_el = findAncestor(el, 'wrap-collapsible');	// find nearest ancestor with this class
	if (collapsible_el) {
		var collapsible_id = collapsible_el.id;
		document.getElementById('collapsible-' + collapsible_id).checked = false;	// close collapsible
		window.location.hash = collapsible_id;	// go to location on page
	}
	else alert('Error: wrap-collapsible not found');
}

// function findAncestor
// - find nearest ancestor element that contains a given class
function findAncestor(el, cls) {
	while ((el = el.parentElement) && !el.classList.contains(cls));
    return el;
}

// open_all_collapse
// - check all checkboxes associated with the class 'collapsibleCB'
function open_all_collapse() {
	var cb = document.getElementsByClassName('collapsibleCB');
	for (var i=0, n=cb.length;i<n;i++) {
		cb[i].checked = true;
	}
}

// close_all_collapse
// - check all checkboxes associated with the class 'collapsibleCB'
function close_all_collapse() {
	var cb = document.getElementsByClassName('collapsibleCB');
	for (var i=0, n=cb.length;i<n;i++) {
		cb[i].checked = false;
	}
}

// function getURLparam 
//   return param passed through URL of name
//	 note: 
function getURLparam(name) {
	var val = currQueryString;
	var paramString = name + '=';	
	var start_pos = val.indexOf('?' + paramString);
	if (start_pos == -1) start_pos = val.indexOf('&' + paramString);
	if (start_pos == -1) return '';
	val = val.substring(start_pos + paramString.length + 1, val.length);
	var end_pos = val.indexOf('&');
	if (end_pos == -1) end_pos = val.length;
	return val.substring(0, end_pos);
}