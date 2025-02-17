import * as igd from './igd-graph.js';

document.head.insertAdjacentHTML("beforeend", `
        <link rel="stylesheet" type="text/css" href="/assets/networks/style/index.css" />
        <link rel="stylesheet" type="text/css" href="/assets/networks/style/foreign.css" />
`
)

const arrayEquiv = (a, b) => a.sort().join() == b.sort().join();

const colors = ["#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab"]

const cohorts = await fetch("/assets/data/fcs_data.json").then(response => response.json());

cohorts.forEach(c => {
    c.ds = c.projects.split(",");
    c.n = parseInt(c.n_participants);
});

const network = {
    datasets: {},
    linkages: []
}

// create datasets:
cohorts.forEach(c => {
    // create datasets
    for(let name of c.ds) {
        if (name in network.datasets) {
            network.datasets[name].n += c.n;
        } else {
            network.datasets[name] = {
                name: name,
                n: c.n
            }
        }
    }
})

// create linkages:
for (let c of cohorts) {
    const links = c.ds.slice();
    const first = links.pop();

    while (links.length) {
        let next = links.pop();
        let link = network.linkages.find(l => arrayEquiv(l.ds, [first, next]));
        if (link) {
            link.n += c.n;
        } else {
            network.linkages.push({
                ds: [first, next],
                n: c.n
            })
        }
    }
}

const sources = await fetch("/assets/data/fcs_src.json").then(response => response.json());

sources.forEach(src => {
    let src_cohorts = cohorts.filter(c => c.ds.some(ds => src.ds.includes(ds)));
    src.n = src_cohorts.map(s => s.n).reduce((a,c) => a+c);
})

const svgw = 1024, svgh = 640;

let svg = document.querySelector("#canvas");
svg.setAttribute("width", svgw); svg.setAttribute("height", svgh);
let bg = document.querySelector("#svg-background");
bg.setAttribute("width", svgw); bg.setAttribute("height", svgh);



var factor = 2.5;

const maxsize = 90**2;
const scale_g = 1/Math.pow(Math.max(...sources.map(n => n.n)), 1/factor);

let all_nodes = [];

const forceRestrain = function(x, y, strength=1) {

    let nodes = [];

    const force = function (alpha) {
        nodes.forEach(n => {
            let dx = x - n.x;
            let dy = y - n.y;

            n.vx += (dx*2/x)*strength; n.vy += (dy*2/y)*strength;
        });
    }

    force.initialize = function (n) {
        nodes = n;
    }

    return force;
}


const createNode = (data) => {
    
    const scale = maxsize*scale_g;
    const radius = Math.sqrt(data.n * scale/Math.PI);
    const u_edge = radius * Math.sqrt(Math.PI);

    let u;
    data.color = data.color || colors[data.index%colors.length] || "grey";
    if (data.ds && data.ds.length > 1) {
        u = document.createElementNS("http://www.w3.org/2000/svg", "use");
        u.setAttribute("href", "#jar");
        u.setAttribute("width", u_edge); u.setAttribute("height", u_edge);
        u.setAttribute("stroke", "#0006"); u.setAttribute("fill", data.color);
        u.setAttribute("stroke-width", "0.25");
        u.dataset.name = data.name;
        const subnodes = [];
        data.ds.forEach((ds, i) => {
            let subdata = network.datasets[ds];
            let sn = createNode({name: subdata.name, n_raw: subdata.n, n: Math.pow(subdata.n, 1/factor), color: data.color});
            sn.source = data.name;
            sn.hide();
            subnodes.push(sn);
        })

        u.addEventListener("click", (e) => { // event name changed to null to remove the event, as we don't need to worry about datasets for now.
            u.parentNode.dispatchEvent(new MouseEvent("click"));

            u.setAttribute("visibility", "hidden");
            title.setAttribute("visibility", "hidden");

            
            const sim = d3.forceSimulation().stop(); // create a STOPPED force simulation
            sim.nodes(subnodes);
            
            // initialise positions:
            igd.ringify(subnodes, [data.x - 80, data.y-80, data.x+80, data.y+80]).forEach(n => { n.data.x = n.x; n.data.y = n.y });
            // show nodes:
            subnodes.forEach(sn => { sn.show(), sn.showlabel = false; });

            let p = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p.setAttribute("fill", "none");
            p.setAttribute("stroke", data.color);
            p.setAttribute("stroke-width", "5");
            svg.appendChild(p);
            p.after(title);

            title.classList.add("active");
            title.removeAttribute("visibility");

            const getBounds = () => {
                return {
                    xmin: Math.min(...subnodes.map(n => n.x - n.radius), data.x-100),
                    xmax: Math.max(...subnodes.map(n => n.x + n.radius), data.x+100),
                    ymin: Math.min(...subnodes.map(n => n.y - n.radius)),
                    ymax: Math.max(...subnodes.map(n => n.y + n.radius))
                }

            }
            const resizeBounds = () => {
                const bounds = getBounds();
                p.setAttribute("d", `M ${bounds.xmin - 5} ${bounds.ymin - 5} L ${bounds.xmin - 5} ${bounds.ymax + 5} L ${bounds.xmax + 5} ${bounds.ymax + 5} L ${bounds.xmax + 5} ${bounds.ymin - 5} Z`);
                title.setAttribute("x", bounds.xmin - 3);
                title.setAttribute("y", bounds.ymin - 3);
            }

            render_linkage(); 
            resizeBounds();

            // pack using forces:
            sim.force("restrain", null);
            sim.force("restrain", forceRestrain(data.x, data.y));

            sim.force("collide", null);
            sim.force("collide", d3.forceCollide(function(n) { return n.radius * (1 + 1/factor); }).iterations(2))

            sim.alphaMin(1/(subnodes.length*5));

            sim.on("tick", () => {
                update_linkage(); resizeBounds();
            });

            sim.on("end", () => { 
                subnodes.forEach(sn => sn.showlabel = true);

                const bounds = getBounds();

                let close = document.createElementNS("http://www.w3.org/2000/svg", "g");
                close.setAttribute("transform", `translate(${bounds.xmax+3},${bounds.ymin - 3})`);
                close.classList.add("close");

                const close_c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                close_c.setAttribute("cx", 0); close_c.setAttribute("cy", 0); close_c.setAttribute("r", 10);
                close_c.setAttribute("fill", "white");
                close.appendChild(close_c);

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", "M 4 -2 L 0 2 L -4 -2");
                path.setAttribute("fill", "none");
                path.setAttribute("stroke", data.color);
                path.setAttribute("stroke-width", 2);
                close.appendChild(path);

                svg.appendChild(close);

                close.addEventListener("click", () => {
                    subnodes.forEach(sn => sn.showlabel = false);

                    const close_sim = d3.forceSimulation().stop();
                    close_sim.nodes(subnodes);
                    close_sim.force("restrain", forceRestrain(data.x, data.y, 2.5));
                    close_sim.alphaMin(1/(subnodes.length*5));

                    close_sim.on("tick", () => {
                        update_linkage()
                        resizeBounds();
                    });

                    close_sim.on("end", () => {
                        subnodes.forEach(sn => sn.hide());
                        u.removeAttribute("visibility");
                        
                        title.setAttribute("x", data.x  - title.querySelector("div").offsetWidth/2);
                        title.setAttribute("y", data.y - title.querySelector("div").offsetHeight/2);
                        title.removeAttribute("visibility");
                        render_linkage();
                    })

                    title.classList.remove("active");
                    title.setAttribute("visibility", "hidden");

                    p.remove();
                    close.remove();
                    close_sim.restart();
                })
            
            })
            sim.restart();
    });
    } else {
        if (data.ds) {
            data.name = data.ds[0];
        }

        u = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        u.setAttribute("r", radius);
        u.setAttribute("fill", data.color); u.setAttribute("stroke", u.getAttribute("fill")); u.setAttribute("stroke-width", 1);
        u.dataset.name = data.name;
    }

    let title = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
    title.insertAdjacentHTML("afterbegin",`
            <div xmlns="http://www.w3.org/1999/xhtml">
                <h3>${data.name.replaceAll("_", " ")}</h3>
                <p>${data.n_raw} patients.</p>
            </div>
        `);
    title.setAttribute("overflow", "visible");

    u.addEventListener("click", (e) => {
        e.stopPropagation();

        if (u.tagName.toLowerCase() == "circle") {
            svg.querySelectorAll(".selected").forEach(s => s.classList.remove("selected"));

            u.classList.add("selected");
            title.classList.add("selected");
            if (!(svg.lastChild == title)) {
                svg.lastChild.after(u, title);
            }
        }
    })

    const node = {
        get x() { return data.x }, 
        set x(value) { 
            data.x = value; 
            if (u.tagName.toLowerCase() == "use") {
                u.setAttribute("x", data.x - u_edge/2);
                title.setAttribute("x", data.x - title.querySelector("div").offsetWidth/2);
            } else {
                u.setAttribute("cx", data.x);
                title.setAttribute("x", data.x - title.querySelector("div").offsetWidth/2);
            }
        },
        get y() { return  data.y },
        set y(value) { 
            data.y = value; 
            if (u.tagName.toLowerCase() == "use") {
                u.setAttribute("y", data.y - u_edge/2);
                title.setAttribute("y", data.y - title.querySelector("div").offsetHeight/2);
            } else {
                u.setAttribute("cy", data.y);
                title.setAttribute("y", data.y - title.querySelector("div").offsetHeight/2);
            }
        },
        color: data.color || colors[data.index%colors.length],
        name: data.name,
        n: data.n,
        n_raw: data.n_raw,
        hide: function() { u.setAttribute("visibility", "hidden"); title.setAttribute("visibility", "hidden") },
        show: function() { u.removeAttribute("visibility"); title.removeAttribute("visibility"); },
        get hidden() { return u.getAttribute("visibility") == "hidden" },
        set showlabel(value) { value? title.removeAttribute("visibility"): title.setAttribute("visibility", "hidden" );},
        get radius() { return radius; }
    }

    svg.appendChild(u);
    svg.appendChild(title);

    all_nodes.push(node);
    return node;
}

const render_sources = function() {
    Array.from(svg.children).filter(e => e.tagName.toLowerCase() != "defs" && e.tagName.toLowerCase() != "rect").forEach(e => e.remove());
    const nodelist = igd.gridify(sources, [20,20,svgw-40,svgh-40]).map((n, i) => {
        n.data.n_raw = n.data.n;
        n.data.n = Math.pow(n.data.n, 1/factor);
        let node = createNode(Object.assign(n.data, { index: i}));
        node.x = n.x; node.y = n.y;
        return node;
    })

    render_linkage();
}

const render_linkage = function() {
    clear_linkage();
    const merged_edges = {};
    
    const draw = (edge, gradient, scale=scale_g, maxweight=25, links=Object.values(merged_edges).length) => {

        let path = document.createElementNS("http://www.w3.org/2000/svg", "line")
        path.setAttribute("class", "linkage");

        path.setAttribute("stroke", `url('#${gradient}')`);
        path.setAttribute("stroke-width", Math.pow(edge.weight, 1/factor) * scale * maxweight);

        // path specific attributes:
        //path.setAttribute("d", pathd);
        //path.setAttribute("fill", "none");

        // line specific attributes:
        path.setAttribute("x1", edge.start[0])
        path.setAttribute("y1", edge.start[1])
        path.setAttribute("x2", edge.end[0])
        path.setAttribute("y2", edge.end[1])

        path.setAttribute("opacity", 0.5 + 1/links)
        // we always want links under all elements, so push to the top of the svg stack.
        svg.insertAdjacentElement("afterbegin", path);
    }

    // this should merge edges if they link studies rather than datasets:
    network.linkages.forEach(l => {
        // find_ds returns a node representing the dataset if it's visible, or the node of its containing source if not
        let dn1 = find_ds(l.ds[0]);
        let dn2 = find_ds(l.ds[1]);

        if (dn1 && dn2) {
            if (dn1 == dn2) return;

            let linkid = `${dn1.name}>${dn2.name}`;
            
            if (linkid in merged_edges) {
                merged_edges[linkid].weight += l.n;
            } else {
                merged_edges[linkid] = igd.edge(dn1, dn2, l.n);
            }
            // create an appropriate color gradient
            if (svg.querySelectorAll(`#${linkid}`).length == 0) {
                svg.querySelector("defs").insertAdjacentHTML("beforeend", 
                `<linearGradient id="${linkid}" class="linkage" x1="${dn1.x}" x2="${dn2.x}" y1="${dn1.y}" y2="${dn2.y}" gradientUnits="userSpaceOnUse">
                        <stop offset="25%" stop-color="${dn1.color}" />
                        <stop offset="75%" stop-color="${dn2.color}" />
                    </linearGradient>`)
            }
        }
        // if we can't find both datasets then we can't represent this linkage in the current display!
    })
    const refweight = Math.max(...Object.values(merged_edges).map(e => e.weight));

    for (let id in merged_edges) {
        console.log(merged_edges[id], refweight);
        draw(merged_edges[id], id, 1/Math.pow(refweight, 1/factor));
    }
}

const update_linkage = function() {
    svg.querySelectorAll("linearGradient").forEach(lg => {
        let ds1, ds2;

        [ds1, ds2] = lg.getAttribute("id").split(">").map(ds => find_ds(ds));
        lg.setAttribute("x1", ds1.x);
        lg.setAttribute("y1", ds1.y);
        lg.setAttribute("x2", ds2.x);
        lg.setAttribute("y2", ds2.y);

        let line = svg.querySelector(`[stroke="url('#${lg.getAttribute("id")}')"]`);
        line.setAttribute("x1", ds1.x);
        line.setAttribute("y1", ds1.y);
        line.setAttribute("x2", ds2.x);
        line.setAttribute("y2", ds2.y);

    })
}

const clear_linkage = function() {
    svg.querySelectorAll(".linkage").forEach(p => p.remove());
}

const find_ds = function(name) {
    let node = all_nodes.find(n => n.name == name);

    if (node?.hidden) {
        node = all_nodes.find(n => n.name == node.source);
    }

    return node;
}

svg.addEventListener("click", (e) => {
    svg.querySelectorAll(".selected").forEach(s => s.classList.remove("selected"));
});

render_sources();
