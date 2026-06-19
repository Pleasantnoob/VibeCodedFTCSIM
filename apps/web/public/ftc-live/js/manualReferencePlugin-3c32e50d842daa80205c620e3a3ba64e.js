
function getAllIndicesOf(query, str) {
  // i was too lazy to write this myself, so credit to https://stackoverflow.com/questions/3410464/how-to-find-indices-of-all-occurrences-of-one-string-in-another-in-javascript
  let startIndex = 0, index, indices = [];
  while ((index = str.indexOf(query, startIndex)) > -1) {
    indices.push(index);
    startIndex = index + query.length;
  }
  return indices;
}
jQuery.fn.findManualReferences = function (onReference) {
  $(this).each((i, x) => {
    let html = $(x).html();
    // map of index -> (map of manual -> reference). So the text "<RG01>" will result in {0: {GM1: {ref}}, 0: {{GM1R: ref}} is both manuals are in scope
    let matches = {};
    for (let i = 0; i < manualReferenceList.length; i++) {
      let reference = manualReferenceList[i];
      let manual = reference.manual.type;
      let indices = getAllIndicesOf(reference.label, html);
      for (let  j = 0; j < indices.length; j++) {
        let index = indices[j];
        if (!matches[index]) {
          matches[index] = {};
        }
        // throw out a shorter match for the same index of the same manual
        if (!matches[index][manual] || matches[index][manual].label.length < reference.label.length) {
          matches[index][manual] = reference;
        }
      }
    }
    // Restructure the data to a list of match objects in order of index.
    let result = [];
    for (let i in matches) {
      for (let j in matches[i]) {
        result.push({index: parseInt(i), reference: matches[i][j]});
      }
    }
    result.sort((a,b) => a.index - b.index);
    onReference(x, result);
  });
}

jQuery.fn.manualReferencesToLink = function (handleConflict, fullManualName = false) {
  $(this).findManualReferences((e, matches) => {
    // TODO handle conflict - send the callback a list of conflicts and have it pick one.
    e = $(e);
    let html = e.html();
    let offset = 0;
    for (let i = 0; i < matches.length; i++) {
      let startIndex = matches[i].index + offset;
      let ref = matches[i].reference;
      // turn into link
      let text = fullManualName ? ref.manual.name + " " + ref.label.substr(ref.manual.type.length): ref.label;
      let anchor = `<a target="_blank" href="${ref.manual.link}#page=${ref.page}">${text}</a>`;
      html = html.substring(0, startIndex) + anchor + html.substring(startIndex + ref.label.length);
      offset += anchor.length - ref.label.length;
    }
    e.html(html);
  });
}