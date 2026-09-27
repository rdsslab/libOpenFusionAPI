import { Method } from './models.js';

export const getAllMethods = async () => {
	try {
		//const apps = await Application.findAll({ attributes: ["idapp", "app"] });
		const datas = await Method.findAll();
		return datas;
	} catch (error) {
		console.error('Error retrieving:', error);
		throw error;
	}
};

export const defaultMethods = async () => {
	try {
		// console.log(' defaultMethods >>>>>> ');

		let methods = [
			{ id: 'NA', text: `NA` },
			{ id: 'CONNECT', text: `CONNECT` },
			{ id: 'GET', text: `GET` },
			{ id: 'DELETE', text: `DELETE` },
			{ id: 'HEAD', text: `HEAD` },
			{ id: 'PATCH', text: `PATCH` },
			{ id: 'POST', text: `POST` },
			{ id: 'PUT', text: `PUT` },
			{ id: 'QUERY', text: `QUERY` },
			{ id: 'WS', text: `WS` },
			{ id: 'OPTIONS', text: `OPTIONS` }
		];

		// `forEach` con un callback `async` no espera nada, y la funcion que lo contiene
		// ni siquiera era `async`: devolvia `undefined` en el acto, asi que el
		// `await defaultMethods()` del arranque no esperaba nada y las 11 escrituras se
		// quedaban en vuelo. Medido: 11 `MERGE INTO [ofapi_method]` simultaneos en MSSQL,
		// el pico de escrituras mas alto que quedaba tras H35/H36, y el patron que
		// produce el 1205. En serie: una escritura en vuelo, y el arranque no sigue hasta
		// que la tabla de metodos esta sembrada.
		for (const m of methods) {
			try {
				await Method.upsert({
					method: m.id,
					label: m.text
				});
			} catch (error) {
				// Un metodo que falla no puede dejar sin sembrar los que van detras, pero
				// tampoco puede pasar por alto: antes el `catch` solo imprimia el error sin
				// decir de que metodo era, y con once llamadas identicas eso no servia.
				console.error(`Error sembrando el metodo ${m.id}:`, error);
			}
		}
	} catch (error) {
		console.error('Error en defaultMethods:', error);
	}
};
