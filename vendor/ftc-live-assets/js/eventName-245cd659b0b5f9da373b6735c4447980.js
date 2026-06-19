function setEventNameSize(eventNameId, measureCanvasId, originalEventNameId){
	var eventName = $("#"+eventNameId);
  	var canvas = document.getElementById(measureCanvasId).getContext("2d");
  	canvas.font = eventName.css('font-size') + " " + eventName.css("font-family");
  	var text = $("#"+originalEventNameId).text().trim();
  	var measuredSize = canvas.measureText(text).width;
  	if (measuredSize > eventName.width()) {
  		//Search eitherway for first whitespace to break on
  		var center = Math.round(text.length/2);
  		var i = 0;
  		while(center - i >= 0 && center + i < text.length && !(/\s/.test(text[center-i]) || /\s/.test(text[center+i])))i++;
  		var b = /\s/.test(text[center-i]);
  		let ind = b ? center - i : center+i;
  		let s1 = text.substring(0, ind);
  		let s2 = text.substring(ind+1);
  		console.log("Split event name: "+s1+", "+s2);
  		eventName.html(s1 + "<br>" + s2);
  		eventName.addClass('two');
  		var size = 45;
  		canvas.font = size + "px " + eventName.css("font-family");
  		while(canvas.measureText(s1).width > eventName.width() || canvas.measureText(s2).width > eventName.width()){
  			size--;
  			canvas.font = size + "px " + eventName.css("font-family");
  		}
  		eventName.css("font-size", size + "px");
  	}
}