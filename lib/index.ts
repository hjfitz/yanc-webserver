import http from 'http'
import {parse} from 'url'
import querystring from 'querystring'
import debug from 'debug'

import Request from './request'
import Response from './response'

const d = debug('serv')


type Middleware = (req: any, res: any, next?: Middleware) => void | Promise<void>
type Void = (...args: any[]) => void

interface Route {
	method: string
	url: string
	func: Middleware
}

const matches = (req: any, mw: Route): boolean => {
	d('handling match')
	if (!mw) return false
	d('req, mw', req.url, mw.url)
	d('req, mw', req.method, mw.method)
	const urlMatches = (req.url === mw.url)
	const methodMatches = (req.method === mw.method) || mw.method === '*'
	d(methodMatches && urlMatches)
	return methodMatches && urlMatches
}

const notfound: Middleware = (req, res) => res.sendStatus(404)

const makeUrl = () => {}

// router can be a route as router.func should handle sub-routing
export class Router implements Route {
	routes: Route[] = []
	method: string
	url: string
	constructor(url: string, method: string) {
		this.url = url || 'none'
		this.method = method || 'none'
	}

	next(req: any, res: any, routes: any[]) {
		return () => {
			const r = new Router(this.url, this.method)
			r.routes = routes
			r.handle(req, res)
		}
	}

	handle(req: any, res: any): any {
		// shallow clone current routes
		const cloned = [...this.routes]
		let cur = cloned.shift()
		// todo: use this.url to help match route
		while (cur && !matches(req, cur))
			cur = cloned.shift()

		d('is router:', cur instanceof Router)

		if (!cur)
			notfound(req, res)
		else
			cur.func(req, res, this.next(req, res, cloned))
	}

	subroute = (router: Router): void => {
		this.routes.push(router)
	}

	add = (method: string, url: string, func: Middleware): void => {
		if (func instanceof Router) {
			d('subrouting...')
			func.url = url
			func.method = method
			this.subroute(func)
			return
		}
		this.routes.push({method, url, func})
	}

	// if we're calling func, we're looking for a subrouter. handle this here
	func = this.handle

	get = this.add.bind(this, 'GET')
	post = this.add.bind(this, 'POST')
	put = this.add.bind(this, 'PUT')
	path = this.add.bind(this, 'PATCH')
	delete = this.add.bind(this, 'DELETE')
	head = this.add.bind(this, 'HEAD')
}


class Server extends Router {
	private server: http.Server

	constructor() {
		super('/', '*')
		this.listener = this.listener.bind(this)
		this.server = http.createServer(this.listener)
	}

	public listen = (port: number, cb: Void): void => {
		this.server.listen(port, cb)
	}

	private async listener(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		d('===BEGINNING PARSE===')
		// firstly, parse the request and response - make it a little more express-like
		const parsedReq = await Server.parseRequest(req)
		const parsedRes = new Response(res, parsedReq)

		d('attempting to handle')
		this.handle(parsedReq, parsedRes)

		d('===END PARSE===')
	}

	// todo: add stack to req
	static parseRequest(req: http.IncomingMessage): Promise<Request> {
		// get what we're interested from the pure request
		const {url, headers, method, statusCode} = req
		const {query, pathname} = parse(url || '')
		const pQuery = querystring.parse(query || '')


		d('beginning request parse')
		const parsedRequest = new Request({statusCode, pathname, headers, method, req, query: pQuery})

		// attempt to parse incoming data
		d(`content type: ${headers['content-type']}`)
		if (!('content-type' in headers)) return Promise.resolve(parsedRequest)

		d('parsing incoming stream...')
		// handleIncomingStream returns itself - resolve after handling
		return parsedRequest.handleIncomingStream(headers['content-type'])
	}
}

export default function createServer() {
	return new Server()
}
