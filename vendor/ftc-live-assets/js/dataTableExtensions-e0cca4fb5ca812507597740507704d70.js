jQuery.fn.dataTable.ext.errMode = function ( settings, techNote, message ) {
    if(techNote === 7) {
        throw "DataTables ajax error: " + settings.ajax.url
    } else {
        throw message;
    }
}

jQuery.fn.dataTable.render.linkCell = function ( linkRenderFunction, defaultContent, renderFunc ) {
    return function ( data, type, row ) {
        let renderedData = data || defaultContent || '';
        if(renderFunc) {
            renderedData = renderFunc(data, type, row)
        }
        renderedData = renderedData.toString()
        // If there's a button or link, it isn't safe to make the parent a link
        if(type !== 'display' || renderedData.includes("<button") || renderedData.includes("<a")) {
            return renderedData;
        }
        const href = linkRenderFunction(row)
        if (href) {
            return `<a class="cell-link" href="${href}">${renderedData}</a>`
        } else {
            return renderedData;
        }
    };
};

jQuery.fn.LinkedDataTable = function (params) {
    params.columns.forEach(col => {
        col.render = jQuery.fn.dataTable.render.linkCell(params.linkRender, col.defaultContent, col.render)
    })
    params.language = window.dataTableTranslations
    const ret = this.DataTable(params)
    const that = this
    ret.on('draw.dt', function() {
        if (!params?.skipRowHeightCalc) {
            that.find("tr").each(function () {
                var rowHeight = 0;
                $(this).find('td').each(function () {
                    if ($(this).outerHeight() > rowHeight) {
                        rowHeight = $(this).outerHeight();
                    }
                });
                $(this).find('.cell-link').each(function () {
                    $(this).css("height", rowHeight + 'px');
                });
            });
        }
    })
    return ret
}
