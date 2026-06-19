const MATCH_LENGTH = 158000;
let loaded = false;
let cycleTable;
let cycleTimes = [];
let review = [];
let redLag = [];
let blueLag = [];
let redReview = [];
let blueReview = [];
let condensed = true;

/**
 * render function for relative time: Xm Ys
 */
function renderRelativeTime (d,t,r) {
    if (isNaN(d)) {
        return "";
    }
    let m = Math.floor(d / 60000);
    let s = Math.floor((d % 60000) / 1000);
    return m + "m " + s + "s";
}

/**
 * render function for relative time: Xs
 */
function renderRelativeTimeSeconds (d,t,r) {
    if (isNaN(d)) {
        return "";
    }
    return Math.floor(d / 1000) + "s";
}

/**
 * render function for an average of sampled relative time: X.Xs
 */
function renderAverageSeconds (d, t, r) {
    if (isNaN(d)) {
        return "";
    }
    return (d / 1000).toFixed(1) + "s";
}

/**
 * Returns undefined if <=0. used to filter out data that shouldn't be shown or counted.
 * For example, when paper scoresheets result in 0 review time or disruption results in negative review time.
 * @param x
 * @returns {*|undefined}
 */
function forcePositive(x) {
    return x > 0 ? x : undefined;
}

/**
 * Populates the cycle times table
 */
function populateTable(cycles, shortNames) {
    let renderTime = (d,t,r) => {
        if (t === 'display') {
            return d ? `<span title="${formatDateTime(new Date(d))}">${formatTime(new Date(d))}</span>` : ''
        }
        return d ? d : 0;
    }
    const SUFFIX_ON_TIME = t`(On Time)`;
    const SUFFIX_AHEAD = t`Ahead`;
    const SUFFIX_BEHIND = t`Behind`;
    const REPLAY = t`(Replay)`;
    let getDifference = (r,t,s,m) => {
        if (!r.match.status.scheduledStart) {
            return "";
        }
        if (r.play > 1) {
            return REPLAY;
        }
        let d = r.startTime - r.match.status.scheduledStart;
        let mag = Math.abs(d);
        mag = Math.floor(mag / 60000);
        let suffix = (mag === 0 ? SUFFIX_ON_TIME : (d < 0 ? SUFFIX_AHEAD : SUFFIX_BEHIND));
        return mag + "m " + suffix;
    };
    let pad = (ns, num) => {
        let n = ns ? "(" + num : num;
        return "<div class='text-center' style='float:left;width:50px;'>" + n + (ns ? ")" : "&nbsp;") + "</div>";
    }
    let renderAlliance = (a,d,t,r) => {
        return d.filter(x => x.alliance === a).sort((a,b) => a.station - b.station).map(x => pad(x.noShow, x.team.number)).join(" ");
    }
    cycleTable = $("#cycleTable").DataTable({
        data: cycles,
        columns: [
            {title: t`Match`, data: "match.matchId", render: (d,t,r) => shortNames.get(d)},
            {title: t`Field`, data: "match.field"},
            {title: t`Red Alliance`, data: "match.stations", render: (d,t,r) => renderAlliance(0,d,t,r), className: "teams", visible: false},
            {title: t`Blue Alliance`, data: "match.stations", render: (d,t,r) => renderAlliance(1,d,t,r), className: "teams", visible: false},
            {title: t`Scheduled Start`, data: "match.status.scheduledStart", defaultContent: "", render: renderTime},
            {title: `<span title="${t`The actual start time of the match`}">${t`Start`}</span>`, data: "startTime", defaultContent: "", render: renderTime},
            {title: `<span title="${t`The difference between scheduled and actual start time`}">${t`Difference`}</span>`, data: (d) => getDifference(d)},
            {title: `<span title="${t`Time from buzzer until red ref entered review`}">${t`Red Lag`}</span>`, data: (r,t,s,m) => r.redToReview - r.startTime - MATCH_LENGTH, render: renderRelativeTimeSeconds, className: "detail"},
            {title: `<span title="${t`Time from buzzer until red ref submitted review`}">${t`Red Review`}</span>`, data: (r,t,s,m) => r.redSubmit - r.startTime - MATCH_LENGTH, render: renderRelativeTime, className: "detail"},
            {title: `<span title="${t`Time from buzzer until blue ref entered review`}">${t`Blue Lag`}</span>`, data: (r,t,s,m) => r.blueToReview - r.startTime - MATCH_LENGTH, render: renderRelativeTimeSeconds, className: "detail"},
            {title: `<span title="${t`Time from buzzer until blue ref submitted review`}">${t`Blue Review`}</span>`, data: (r,t,s,m) => r.blueSubmit - r.startTime - MATCH_LENGTH, render: renderRelativeTime, className: "detail"},
            {title: `<span title="${t`Time from buzzer until scorekeeper commit`}">${t`Review Time`}</span>`, data: (r,t,s,m) => forcePositive(r.scorekeeperCommit - r.startTime - MATCH_LENGTH), render: renderRelativeTime},
            {title: `<span title="${t`Time from start of match to start of next match`}">${t`Cycle Time`}</span>`, data: "cycleTime", render: (d,t,r) => {
                    let res = renderRelativeTime(d,t,r);
                    if (res && r.hasBreak) {
                        res += " (B)"
                    }
                    return res;
                }}
        ],
        paging: false,
        order: [[5, "asc"]]
    });
    let details = $(`<label class="d-print-none" ><input type="checkbox" id="showDetailed" onclick="toggleDetail()" checked/>${t`Detailed`}</label>`);
    let teams = $(`<label class="d-print-none" ><input type="checkbox" id="showTeams" onclick="toggleTeams()"/>${t`Teams`}</label>`);
    $("#cycleTable_wrapper > div:nth-child(1) > div:nth-child(1)").append(details).append(teams);
}

/**
 * Populates various cumulative statistics
 */
function populateStats(cycles) {
    // [cycles, cycles no break, review, red lag, blue lag, {red field 1 lag, blue field 1 lag}, {red field 2 lag, blue field 2 lag}, {red field 3 lag, bleu field 3 lag}, ...]
    let sums = [0,0,0,0,0];
    let ns = [0,0,0,0,0];
    for (let i = 0; i < cycles.length; i++) {
        let cycle = cycles[i];
        if (cycle.match.tournamentLevel === "QUALIFICATION" && cycle.cycleTime) {
            sums[0] += cycle.cycleTime
            ns[0]++;
            if (!cycle.hasBreak) {
                sums[1] += cycle.cycleTime;
                ns[1]++;
                cycleTimes.push(cycle.cycleTime);
            }
        }
        if (cycle.scorekeeperCommit) {
            let reviewTime = cycle.scorekeeperCommit - cycle.startTime - MATCH_LENGTH;
            if (forcePositive(reviewTime)) {
                sums[2] += reviewTime;
                ns[2]++;
                review.push(reviewTime);
            }
        }
        if (cycle.redToReview) {
            let lag = cycle.redToReview - cycle.startTime - MATCH_LENGTH;
            sums[3] += lag;
            ns[3]++;
            redLag.push(lag);
            if (cycle.match.field) {
                let idx = 3 + (2 * cycle.match.field);
                sums[idx] = sums[idx] ? sums[idx] + lag : lag;
                ns[idx] = ns[idx] ? ns[idx] + 1 : 1;
            }
        }
        if (cycles[i].blueToReview) {
            let lag = cycles[i].blueToReview - cycles[i].startTime - MATCH_LENGTH;
            sums[4] += lag;
            ns[4]++;
            blueLag.push(lag);
            if (cycle.match.field) {
                let idx = 4 + (2 * cycle.match.field);
                sums[idx] = sums[idx] ? sums[idx] + lag : lag;
                ns[idx] = ns[idx] ? ns[idx] + 1 : 1;
            }
        }
        if (cycles[i].redSubmit) {
            redReview.push(cycles[i].redSubmit - cycles[i].startTime - MATCH_LENGTH)
        }
        if (cycles[i].blueSubmit) {
            blueReview.push(cycles[i].blueSubmit - cycles[i].startTime - MATCH_LENGTH)
        }
    }
    $("#avgCycles").text(renderRelativeTime(sums[0] / ns[0]))
    $("#avgCyclesNoBreak").text(renderRelativeTime(sums[1] / ns[1]))
    $("#avgReview").text(renderRelativeTime(sums[2] / ns[2]))
    $("#avgRedLag").text(renderAverageSeconds(sums[3] / ns[3]))
    $("#avgBlueLag").text(renderAverageSeconds(sums[4] / ns[4]))
    if (sums.length > 6) { // >1 field
        let cols = [
            {title: t`Alliance`, data: "alliance"},
            {title: "idx", data: "idx", visible: false},
        ];
        for (let i = 5; i < sums.length; i += 2) {
            let fieldNum = Math.floor((i-3) / 2);
            cols.push({title: t`Field ${fieldNum} Average Lag`, data: (r,t,s,m) => sums[i + r.idx] / ns[i + r.idx], render: renderAverageSeconds});
        }
        $("#lagTable").DataTable({
            data: [
                {alliance: "Red", idx: 0},
                {alliance: "Blue", idx: 1}
            ],
            columns: cols,
            order:[[1, "asc"]],
            searching: false,
            paging: false
        });
        $("#lagTable").prop("hidden", false);
    }
}

/**
 * First draw of graphs
 */
function firstLoad() {
    let traces = [
        {x:review.map(x => x / 1000)},
        {x:redLag.map(x => x / 1000)},
        {x:blueLag.map(x => x / 1000)},
        {x:redReview.map(x => x / 1000)},
        {x:blueReview.map(x => x / 1000)},
        {x:cycleTimes.map(x => x / 1000)}
    ];
    for(let i = 0; i < traces.length; i++){
        traces[i].type = 'histogram';
        traces[i].xbins = {size:5};
    }
    traces[5].xbins.size = 20;//cycle time is an order or magnitude larger
    let labels = [ t`Review Time (s)`, t`Red Lag Time (s)`, t`Blue Lag Time (s)`, t`Red Review Time (s)`, t`Blue Review Time (s)`, t`Cycle Time (s)`];
    let params = []
    let datas = [];
    for(let i = 0; i < traces.length; i++){
        datas[i] = [traces[i]];
        params[i] = {
            margin: {t:0},
            xaxis: {title:labels[i], rangemode: 'nonnegative'},
            yaxis: {title: t`Matches`}
        }
    }
    params[1].xaxis.range = [0,60];
    params[2].xaxis.range = [0,60];
    params[3].xaxis.range = [0,120];
    params[4].xaxis.range = [0,120];
    params[0].xaxis.range = [0,120];
    params[5].xaxis.range = [150, 600];
    params[5].yaxis.title = t`Cycles`;


    Plotly.newPlot('reviewTime', datas[0], params[0]);
    Plotly.newPlot('redLag', datas[1], params[1]);
    Plotly.newPlot('blueLag', datas[2], params[2]);
    Plotly.newPlot('redReview', datas[3], params[3]);
    Plotly.newPlot('blueReview', datas[4], params[4]);
    Plotly.newPlot('cycles', datas[5], params[5]);

    let scatters = [{
        x: Array.from(Array(cycleTimes.length).keys()),
        y: cycleTimes.map(x => x / 1000)
    }, {
        x: Array.from(Array(review.length).keys()),
        y: review.map(x => x / 1000),
    }, {
        x: Array.from(Array(redLag.length).keys()),
        y: redLag.map(x => x / 1000)
    }, {
        x: Array.from(Array(blueLag.length).keys()),
        y: blueLag.map(x => x / 1000)
    }, {
        x: Array.from(Array(redReview.length).keys()),
        y: redReview.map(x => x / 1000)
    }, {
        x: Array.from(Array(blueReview.length).keys()),
        y: blueReview.map(x => x / 1000)
    }];
    for (let i = 0; i < scatters.length; i++) {
        scatters[i].mode = 'line';
        scatters[i].type = 'scatter';
        if (i > 1) {
            scatters[i].line = {color: i % 2 === 0 ? 'red' : 'blue'};
            scatters[i].name = i % 2 === 0 ? 'red' : 'blue';
        }
    }
    let scatterParam = {xaxis: {title: t`Match / Play`}};
    Plotly.newPlot('cyclesLine', [scatters[0]], Object.assign({yaxis: {title: t`Cycle Time (s)`, rangemode: 'tozero'}}, scatterParam));
    Plotly.newPlot('reviewTimeLine', [scatters[1]], Object.assign({yaxis: {title: t`Review Time (s)`, rangemode: 'tozero'}}, scatterParam));
    Plotly.newPlot('lagLine', [scatters[2], scatters[3]], Object.assign({yaxis: {title: t`Referee Lag Time (s)`, rangemode: 'tozero'}}, scatterParam));
    Plotly.newPlot('reviewLine', [scatters[4], scatters[5]], Object.assign({yaxis: {title: t`Referee Review Time (s)`, rangemode: 'tozero'}}, scatterParam));
}

/** Redrawing of graphs on view change */
function redraw(){
    $(".splitGraph").each((i, x) => Plotly.relayout($(x).attr("id"), {width: $(x).width(), height: $(x).height()}))
}

/** Toggle between table & charts */
function toggleChart(){
    var reports = $("#report");
    var base = reports.prop("hidden");
    reports.prop("hidden", !base);
    $("#graphs").prop("hidden", base);
    if(!base && !loaded) {
        firstLoad();
        loaded = true;
    } else{
        redraw();
    }
    $("#toggleBtn").find("i").removeClass("fa-chart-column fa-table").addClass(base ? "fa-chart-column" : "fa-table");
}

/** Toggle visibility of referee columns*/
function toggleDetail() {
    if ($("#showDetailed").prop("checked")) {
        cycleTable.columns(".detail").visible(true);
    } else {
        cycleTable.columns(".detail").visible(false);
    }
}

/** Toggle visibility of alliance columns */
function toggleTeams() {
    if ($("#showTeams").prop("checked")) {
        cycleTable.columns(".teams").visible(true);
    } else{
        cycleTable.columns(".teams").visible(false);
    }
}

/** Toggle full-width container*/
function toggleCondensed() {
    condensed = !condensed;
    if (condensed) {
        $(".container").removeClass("wide");
    } else {
        $(".container").addClass("wide");
    }
    if (loaded) {
        redraw();
    }
    $("#toggleCondense").find("i").removeClass("fa-expand fa-compress").addClass(condensed ? "fa-expand" : "fa-compress");
}
